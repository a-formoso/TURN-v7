"""Small, data-only contract for this isolated benchmark; not an app schema."""
import json
import math

PANELS = ("TL", "TR", "BL", "BR")


def number(value, low, high, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(label + " must be a number")
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(label + " is outside the allowed range")
    return value


def vector(value, low, high, label):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(label + " must have three numbers")
    for item in value:
        number(item, low, high, label)


def validate_scene(scene):
    if not isinstance(scene, dict) or scene.get("schema") != "kinolot-blockout-test-v1":
        raise ValueError("Unsupported benchmark scene")
    objects = scene.get("objects")
    if not isinstance(objects, list) or not 1 <= len(objects) <= 500:
        raise ValueError("Expected between one and 500 objects")
    materials = scene.get("materials",{})
    if not isinstance(materials,dict) or len(materials)>32:
        raise ValueError("Invalid material library")
    ids = set()
    for item in objects:
        if not isinstance(item, dict):
            raise ValueError("Invalid box")
        ident = item.get("id")
        if not isinstance(ident, str) or not ident or len(ident) > 100 or ident in ids:
            raise ValueError("Missing or duplicate object identity")
        ids.add(ident)
        if not isinstance(item.get("name"), str) or len(item["name"]) > 160:
            raise ValueError("Invalid object name")
        vector(item.get("position"), -10000, 10000, "Box position")
        vector(item.get("rotation"), -8 * math.pi, 8 * math.pi, "Box rotation")
        vector(item.get("size"), 0.001, 10000, "Box dimensions")
        if item.get("kind","box") not in ("box","cylinder","torus","wedge","prism"):
            raise ValueError("Unsupported primitive kind")
        if item.get("kind") == "prism":
            points = item.get("footprint")
            if not isinstance(points, list) or not 3 <= len(points) <= 32:
                raise ValueError("A prism needs 3–32 footprint corners")
            for point in points:
                if not isinstance(point, list) or len(point) != 2:
                    raise ValueError("Invalid footprint corner")
                for value in point:
                    number(value, -.5, .5, "Normalised footprint")
            for axis in (0, 1):
                if abs(min(p[axis] for p in points) + .5) > .00001 or abs(max(p[axis] for p in points) - .5) > .00001:
                    raise ValueError("Prism bounds must match its dimensions")
        if materials and (not isinstance(item.get("material"), str) or item["material"] not in materials):
            raise ValueError("Object references an unknown material")
    for material in materials.values():
        if not isinstance(material,dict):
            raise ValueError("Invalid material")
        vector(material.get("baseColor"),0,1,"Material colour")
        number(material.get("metallic",0),0,1,"Material metallic")
        number(material.get("roughness",.5),0,1,"Material roughness")
        number(material.get("emissionStrength",0),0,20,"Material emission")
    lights=scene.get("previewLights",[])
    if not isinstance(lights,list) or len(lights)>16:
        raise ValueError("Too many preview lights")
    for light in lights:
        if not isinstance(light,dict):
            raise ValueError("Invalid preview light")
        vector(light.get("position"),-10000,10000,"Light position")
        vector(light.get("colour"),0,1,"Light colour")
        number(light.get("powerWatts"),0,5000,"Light power")
        number(light.get("sizeMetres"),.01,20,"Light size")
    cameras = scene.get("cameras")
    if not isinstance(cameras, dict) or set(cameras) != set(PANELS):
        raise ValueError("Exactly four plate cameras are required")
    for camera in cameras.values():
        vector(camera.get("position"), -10000, 10000, "Camera position")
        number(camera.get("yaw"), -360, 360, "Camera yaw")
        number(camera.get("pitch"), -89, 89, "Camera pitch")
        number(camera.get("lensMm"), 8, 200, "Camera lens")
    return scene


def read_scene(path):
    def invalid_constant(value):
        raise ValueError("Non-finite JSON number: " + value)
    with open(path, encoding="utf-8") as stream:
        return validate_scene(json.load(stream, parse_constant=invalid_constant))
