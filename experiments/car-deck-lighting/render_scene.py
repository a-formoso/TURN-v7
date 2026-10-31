"""Run only inside a fresh Blender background process. No network operations."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scene_contract import PANELS, read_scene


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def save_png(path, pixels):
    height, width = pixels.shape[:2]
    image = bpy.data.images.new(path.stem, width, height, alpha=False)
    image.colorspace_settings.name = "Non-Color"
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(pixels, 0, 1)
    image.pixels.foreach_set(rgba[::-1].ravel())
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def load_pixels(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    image.colorspace_settings.name = "Non-Color"
    pixels = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    result = pixels.reshape(image.size[1], image.size[0], 4)[::-1].copy()
    bpy.data.images.remove(image)
    return result


def emission(name, rgb):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeEmission")
    shader.inputs["Color"].default_value = (*rgb, 1)
    shader.inputs["Strength"].default_value = 1
    material.node_tree.links.new(shader.outputs[0], output.inputs[0])
    return material


def id_colour(ident, used):
    value = int(hashlib.sha256(ident.encode()).hexdigest()[:6], 16)
    while value in used or value == 0:
        value = (value + 1) % 16777216
    used.add(value)
    return [(value >> shift) & 255 for shift in (16, 8, 0)]


def primitive(item):
    kind = item.get("kind", "box")
    if kind == "box":
        bpy.ops.mesh.primitive_cube_add(size=1)
    elif kind == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=.5, depth=1)
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_segments=24, minor_segments=8,
                                       major_radius=.36, minor_radius=.07)
    elif kind == "prism":
        points = item["footprint"]
        area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points, points[1:]+points[:1]))
        if area < 0:
            points = list(reversed(points))
        n = len(points)
        verts = [(x,y,z) for z in (-.5,.5) for x,y in points]
        faces = [tuple(reversed(range(n))),tuple(range(n,2*n))]
        faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        mesh = bpy.data.meshes.new(item["name"])
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(item["name"], mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj
    else:
        mesh = bpy.data.meshes.new(item["name"])
        mesh.from_pydata([(-.5,-.5,-.5),(.5,-.5,-.5),(-.5,.5,-.5),(.5,.5,-.5),
                          (-.5,.5,.5),(.5,.5,.5)], [],
                         [(0,2,3,1),(2,4,5,3),(0,4,2),(1,3,5),(0,1,5,4)])
        mesh.update()
        obj = bpy.data.objects.new(item["name"], mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj
    obj = bpy.context.object
    # Every primitive has unit local bounds, so dimensions remain explicit data.
    for axis in range(3):
        low = min(v.co[axis] for v in obj.data.vertices)
        high = max(v.co[axis] for v in obj.data.vertices)
        for vertex in obj.data.vertices:
            vertex.co[axis] = (vertex.co[axis]-low)/(high-low)-.5
    return obj


def surface(name, spec):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*spec["baseColor"], 1)
    shader.inputs["Metallic"].default_value = spec.get("metallic", 0)
    shader.inputs["Roughness"].default_value = spec.get("roughness", .5)
    if spec.get("emissionStrength", 0):
        shader.inputs["Emission Color"].default_value = (*spec["baseColor"], 1)
        shader.inputs["Emission Strength"].default_value = spec["emissionStrength"]
    return material


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scene", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--samples", type=int, required=True)
    parser.add_argument("--lighting-study", action="store_true")
    parser.add_argument("--final-lighting", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    source = Path(args.scene).resolve()
    out = Path(args.out).resolve()
    spec = read_scene(source)
    started = time.monotonic()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 2
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    world = bpy.data.worlds.new("Benchmark world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (.04, .04, .04, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = .2
    # Analytic normal shading gives a clean clay guide on CPU, without noisy
    # path-traced lighting or a graphics-dependent Workbench context.
    grey = emission("Blockout grey", (.6, .6, .6))
    nodes = grey.node_tree.nodes
    normal = nodes.new("ShaderNodeNewGeometry")
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = (.3, -.4, .85)
    shade = nodes.new("ShaderNodeMath")
    shade.operation = "MULTIPLY_ADD"
    shade.inputs[1].default_value = .25
    shade.inputs[2].default_value = .55
    links = grey.node_tree.links
    links.new(normal.outputs["Normal"], dot.inputs[0])
    links.new(dot.outputs["Value"], shade.inputs[0])
    links.new(shade.outputs[0], nodes.get("Emission").inputs["Color"])
    geometry = []
    objects = []
    used = set()
    for item in spec["objects"]:
        obj = primitive(item)
        obj.location = item["position"]
        obj.name = item["name"]
        obj.rotation_euler = item["rotation"]
        obj.scale = item["size"]
        obj["benchmarkObjectId"] = item["id"]
        obj["benchmarkAnchorId"] = item.get("anchorId", "")
        obj.data.materials.append(grey)
        geometry.append(obj)
        colour = id_colour(item["id"], used)
        objects.append({**item, "idColourBytes": colour,
            "actualPosition": list(obj.location), "actualRotation": list(obj.rotation_euler),
            "actualLocalSize": [(max(v.co[axis] for v in obj.data.vertices)-
                                 min(v.co[axis] for v in obj.data.vertices))*obj.scale[axis]
                                for axis in range(3)]})
    cameras = {}
    for panel in PANELS:
        pose = spec["cameras"][panel]
        data = bpy.data.cameras.new("Plate " + panel)
        data.lens = pose["lensMm"]
        data.sensor_width = 36
        data.sensor_fit = "HORIZONTAL"
        data.clip_start = .05
        data.clip_end = 200
        obj = bpy.data.objects.new("Camera " + panel, data)
        scene.collection.objects.link(obj)
        obj.location = pose["position"]
        obj.rotation_euler = (math.radians(90 + pose["pitch"]), 0, -math.radians(pose["yaw"]))
        cameras[panel] = obj
    bpy.context.view_layer.update()
    build_seconds = time.monotonic() - started
    camera_records = {}
    for panel, camera in cameras.items():
        direction = camera.matrix_world.to_quaternion() @ Vector((0, 0, -1))
        camera_records[panel] = {"position": list(camera.matrix_world.translation),
            "direction": list(direction), "lensMm": camera.data.lens,
            "sensorWidthMm": camera.data.sensor_width,
            "width": args.width, "height": args.height}
    materials = {name: surface(name, value) for name, value in spec.get("materials", {}).items()}
    for index, light in enumerate(spec.get("previewLights", [])):
        data = bpy.data.lights.new("Preview area " + str(index), "AREA")
        data.energy = light["powerWatts"]
        data.color = light["colour"]
        data.shape = "DISK"
        data.size = light["sizeMetres"]
        obj = bpy.data.objects.new(data.name, data)
        obj.location = light["position"]
        scene.collection.objects.link(obj)
    if args.lighting_study or args.final_lighting:
        # An isolated display/lighting study: the geometry, camera poses and saved scene remain unchanged.
        scene.cycles.samples = 32 if args.final_lighting else 16
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 4
        scene.cycles.seed = 41
        for obj,item in zip(geometry,spec["objects"]):
            obj.data.materials[0] = materials[item["material"]]
        profiles = [
            {"id":"original", "view":"Standard", "exposure":0.0, "power":600, "size":2.5, "colour":[1,.72,.43], "world":.5, "emission":3, "emissionColour":[1,.57,.19]},
            {"id":"matched", "view":"AgX", "exposure":0.0, "power":300, "size":.28, "colour":[1,.60,.28], "world":.15, "emission":1.5},
            {"id":"matched-lower-exposure", "view":"AgX", "exposure":-.7, "power":300, "size":.28, "colour":[1,.60,.28], "world":.15, "emission":1.5}
        ]
        if args.final_lighting:
            profiles = [profiles[1]]
        records=[]
        for profile in profiles:
            scene.view_settings.view_transform=profile["view"]
            scene.view_settings.look="None" if profile["view"]=="Standard" else "AgX - Medium High Contrast"
            scene.view_settings.exposure=profile["exposure"]
            scene.view_settings.gamma=1
            world.node_tree.nodes["Background"].inputs[0].default_value=(.18,.22,.28,1)
            world.node_tree.nodes["Background"].inputs[1].default_value=profile["world"]
            for ob in scene.objects:
                if ob.type=="LIGHT" and ob.location.z<4:
                    ob.data.energy=profile["power"];ob.data.size=profile["size"];ob.data.color=profile["colour"]
            lamp=materials["lampWarm"].node_tree.nodes.get("Principled BSDF")
            lamp.inputs["Emission Strength"].default_value=profile["emission"]
            lamp.inputs["Emission Color"].default_value=(*profile.get("emissionColour",profile["colour"]),1)
            frames=[];start=time.monotonic()
            for panel in (PANELS if args.final_lighting else ["TL"]):
                scene.camera=cameras[panel]
                scene.render.filepath=str(out/(profile["id"]+"_"+panel+".png"))
                bpy.ops.render.render(write_still=True)
                frames.append(Path(scene.render.filepath).name)
            record={**profile,"frames":frames,"seconds":round(time.monotonic()-start,3),"look":scene.view_settings.look,"gamma":scene.view_settings.gamma}
            records.append(record)
            if args.final_lighting:
                bpy.ops.wm.save_as_mainfile(filepath=str(out/"lighting-reference.blend"))
                grid=np.concatenate([np.concatenate([load_pixels(out/(profile["id"]+"_"+p+".png"))[:,:,:3] for p in PANELS[:2]],axis=1),np.concatenate([load_pixels(out/(profile["id"]+"_"+p+".png"))[:,:,:3] for p in PANELS[2:]],axis=1)],axis=0)
                save_png(out/"four-views-lighting.png",grid)
        write_json(out/"lighting-report.json",{"profiles":records,"cameras":camera_records,"blenderVersion":bpy.app.version_string,"device":"CPU","samples":scene.cycles.samples,"sourceSha256":hashlib.sha256(source.read_bytes()).hexdigest(),"objects":len(objects),"wallSeconds":round(time.monotonic()-started,3)})
        print("Lighting study complete",flush=True)
        return

    # Save an editable scene with simple materials, before technical passes.
    scene.camera = cameras["TL"]
    scene.cycles.samples = args.samples
    if materials:
        for obj, item in zip(geometry, spec["objects"]):
            obj.data.materials[0] = materials[item["material"]]
        scene.cycles.samples = max(32, args.samples * 4)
        scene.cycles.max_bounces = 4
        scene.cycles.use_denoising = True
        world.node_tree.nodes["Background"].inputs[0].default_value = (.18, .22, .28, 1)
        world.node_tree.nodes["Background"].inputs[1].default_value = .5
    scene.render.filepath = "//preview.png"
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "blockout.blend"))
    timings = {}
    def render(panel, kind):
        scene.camera = cameras[panel]
        extension = "exr" if kind == "depth_raw" else "png"
        path = out / (kind + "_" + panel + "." + extension)
        scene.render.filepath = str(path)
        start = time.monotonic()
        bpy.ops.render.render(write_still=True)
        timings[kind + "_" + panel] = round(time.monotonic() - start, 4)
        return path
    image_kinds = ["grey", "depth", "id"]
    if materials:
        image_kinds.append("material")
        scene.cycles.samples = max(32, args.samples * 4)
        scene.cycles.max_bounces = 4
        scene.cycles.use_denoising = True
        world.node_tree.nodes["Background"].inputs[0].default_value = (.18, .22, .28, 1)
        world.node_tree.nodes["Background"].inputs[1].default_value = .5
        for panel in PANELS:
            render(panel, "material")
        scene.cycles.use_denoising = False
        scene.cycles.samples = args.samples
        for obj in geometry:
            obj.data.materials[0] = grey
        world.node_tree.nodes["Background"].inputs[0].default_value = (.04, .04, .04, 1)
        world.node_tree.nodes["Background"].inputs[1].default_value = .2
    for panel in PANELS:
        render(panel, "grey")
    # Raw camera-Z in metres. Keep the float source; PNG is a visualisation.
    depth = emission("Camera-Z metres", (1, 1, 1))
    nodes = depth.node_tree.nodes
    depth.node_tree.links.new(nodes.new("ShaderNodeCameraData").outputs["View Z Depth"],
                             nodes.get("Emission").inputs["Strength"])
    for obj in geometry:
        obj.data.materials[0] = depth
    scene.cycles.samples = 1
    scene.cycles.max_bounces = 0
    scene.cycles.filter_width = .01
    scene.view_settings.view_transform = "Raw"
    world.node_tree.nodes["Background"].inputs[1].default_value = 0
    # Technical passes must contain only their encoded emission, no scene lights.
    for obj in scene.objects:
        if obj.type == "LIGHT":
            obj.hide_render = True
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    raw_depths = {}
    depth_stats = {}
    for panel in PANELS:
        raw = load_pixels(render(panel, "depth_raw"))[:, :, 0]
        valid = np.isfinite(raw) & (raw > .01)
        if not valid.any():
            raise RuntimeError("Camera " + panel + " sees no geometry")
        raw_depths[panel] = (raw, valid)
        depth_stats[panel] = {"minMetres": float(raw[valid].min()),
                              "maxMetres": float(raw[valid].max()),
                              "hitPixels": int(valid.sum())}
    # One documented normalisation for ALL four panels, near white/far black.
    near = min(s["minMetres"] for s in depth_stats.values())
    far = max(s["maxMetres"] for s in depth_stats.values())
    for panel, (raw, valid) in raw_depths.items():
        pixels = np.zeros_like(raw)
        pixels[valid] = 1 - np.clip((raw[valid] - near) / max(far - near, 1e-6), 0, 1)
        save_png(out / ("depth_" + panel + ".png"), np.repeat(pixels[:, :, None], 3, axis=2))
    del raw_depths
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    for obj, record in zip(geometry, objects):
        obj.data.materials[0] = emission("ID " + record["id"], [v / 255 for v in record["idColourBytes"]])
    boxes = {}
    for panel in PANELS:
        pixels = load_pixels(render(panel, "id"))[:, :, :3]
        visible = []
        for record in objects:
            colour = np.array(record["idColourBytes"], dtype=np.float32) / 255
            mask = np.max(np.abs(pixels - colour), axis=2) <= 1.1 / 255
            ys, xs = np.nonzero(mask)
            if not len(ys):
                continue
            left, top, right, bottom = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
            visible.append({"objectId": record["id"], "name": record["name"],
                "anchorId": record.get("anchorId"), "pixels": int(len(ys)),
                "boxPixelsLTRB": [left, top, right, bottom],
                "box1000LTRB": [round(1000 * left / args.width), round(1000 * top / args.height),
                                round(1000 * right / args.width), round(1000 * bottom / args.height)],
                "smallAtThisResolution": right - left < 20 or bottom - top < 20})
        if not visible:
            raise RuntimeError("ID pass contains no recognised objects: " + panel)
        boxes[panel] = visible
    for kind in image_kinds:
        panels = [load_pixels(out / (kind + "_" + panel + ".png"))[:, :, :3] for panel in PANELS]
        grid = np.concatenate([np.concatenate(panels[:2], axis=1), np.concatenate(panels[2:], axis=1)], axis=0)
        save_png(out / ("grid_" + kind + ".png"), grid)
    write_json(out / "objects.json", objects)
    write_json(out / "cameras.json", camera_records)
    write_json(out / "visible-objects.json", {"boxConvention": "left, top, right-exclusive, bottom-exclusive", "panels": boxes})
    write_json(out / "render-report.json", {"status": "complete", "blenderVersion": bpy.app.version_string,
        "blenderBuildHash": bpy.app.build_hash.decode(errors="replace"), "engine": "CYCLES", "device": "CPU",
        "sceneSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "objects": len(objects), "resolutionPerPanel": [args.width, args.height], "greySamples": args.samples,
        "imageKinds": image_kinds, "materialSamples": max(32, args.samples * 4) if materials else None,
        "greyTreatment": "analytic surface-normal clay shading; no photometric lighting or cast shadows",
        "buildSeconds": round(build_seconds, 4), "renderSeconds": timings,
        "totalInBlenderSeconds": round(time.monotonic() - started, 4),
        "depth": {"kind": "camera-space Z, metres", "pngMapping": "linear near white, far black; no-hit black",
                  "sharedNearMetres": near, "sharedFarMetres": far, "panels": depth_stats},
        "warnings": spec.get("notes", [])})
    print("Kinolot benchmark complete", flush=True)


if __name__ == "__main__":
    main()
