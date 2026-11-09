/* Offline feasibility prototype. Explicit measurements only; not wired to paid builds. */
const copy = value => JSON.parse(JSON.stringify(value));
const round = value => Math.round(value * 1e6) / 1e6;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const vector = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value);
const rotate = (v, angle) => [Math.cos(angle)*v[0]-Math.sin(angle)*v[1], Math.sin(angle)*v[0]+Math.cos(angle)*v[1], v[2]];

function specifications(scene, groups) {
  if (!Array.isArray(groups) || !groups.length || groups.length > 24) throw Error('Declare the required inventory groups.');
  const ids = new Set(), anchors = new Set();
  return groups.map(group => {
    if (!token(group.id) || ids.has(group.id)) throw Error('Inventory group identities must be unique.');
    ids.add(group.id);
    if (!token(group.templateAnchorId) || anchors.has(group.templateAnchorId)) throw Error('Each group needs a distinct saved template.');
    anchors.add(group.templateAnchorId);
    if (!Number.isInteger(group.quantity) || group.quantity < 1 || group.quantity > 500) throw Error('Declare a bounded positive inventory count.');
    if (!Number.isInteger(group.columns) || group.columns < 1 || group.columns > group.quantity) throw Error('Declare a valid column count.');
    if (![group.origin, group.columnStep, group.rowStep].every(vector)) throw Error('Declare finite inventory positions and spacing.');
    if (!finite(group.rotationRadians)) throw Error('Declare a finite inventory rotation.');
    const parts = scene.objects.filter(item => item.anchorId === group.templateAnchorId);
    if (!parts.length) throw Error('The required template is missing.');
    if (parts.length === 1 && parts[0].kind === 'box') throw Error('An unassembled solid block cannot prove furniture completeness.');
    if (group.quantity > 1 && Math.hypot(...group.columnStep) === 0 && Math.hypot(...group.rowStep) === 0) throw Error('Repeated items need spacing.');
    return {...copy(group), parts};
  });
}

function instances(group) {
  return Array.from({length: group.quantity}, (_, index) => {
    const column = index % group.columns, row = Math.floor(index / group.columns);
    return {index, offset: group.origin.map((_, axis) => column*group.columnStep[axis]+row*group.rowStep[axis])};
  });
}

function place(part, group, instance, partIndex) {
  // The existing anchor is instance zero and never moves. Additional units rotate around its declared origin.
  if (instance.index === 0) return copy(part);
  const local = part.position.map((v, axis) => v-group.origin[axis]);
  const offset = rotate(local, group.rotationRadians);
  const placed = {...copy(part), id: `inventory-${group.id}-${instance.index}-${partIndex}`,
    name: `${part.name} · ${instance.index+1}`.slice(0,160), basis: 'design',
    position: offset.map((v, axis) => round(v+group.origin[axis]+instance.offset[axis])),
    rotation: [part.rotation[0], part.rotation[1], round(part.rotation[2]+group.rotationRadians)]};
  delete placed.anchorId; // Background items are not fictitious saved story anchors.
  return placed;
}

export function expandInventory(scene, groups, validateScene) {
  validateScene(scene);
  const specs = specifications(scene, groups);
  const replacing = new Set(specs.map(group => group.templateAnchorId));
  const objects = scene.objects.filter(item => !replacing.has(item.anchorId)).map(copy);
  const total = objects.length + specs.reduce((sum, group) => sum+group.quantity*group.parts.length, 0);
  if (total > 500) throw Error('The complete inventory exceeds the current renderer object budget.');
  for (const group of specs) for (const instance of instances(group))
    group.parts.forEach((part, i) => objects.push(place(part, group, instance, i)));
  const result = {...copy(scene), objects};
  if (new TextEncoder().encode(JSON.stringify(result)).length > 262144) throw Error('The complete inventory exceeds the current payload budget.');
  validateScene(result);
  return result;
}

// Compare actual emitted objects with independently supplied inventory requirements and the original templates.
// This is a completeness/placement check, not proof of visual quality, collision freedom or brief interpretation.
export function inspectInventory(actual, original, groups, validateScene) {
  validateScene(actual);
  const specs = specifications(original, groups), issues = [], required = new Set();
  const byId = new Map(actual.objects.map(item => [item.id,item]));
  if (byId.size !== actual.objects.length) issues.push('Duplicate object identities.');
  const counts = [];
  for (const group of specs) {
    let complete = 0;
    for (const instance of instances(group)) {
      let intact = true;
      group.parts.forEach((part, i) => {
        const expected = place(part, group, instance, i);
        required.add(expected.id);
        const current = byId.get(expected.id);
        if (!current) { issues.push(`Missing part in ${group.id}, item ${instance.index+1}.`); intact = false; return; }
        if (JSON.stringify(current) !== JSON.stringify(expected)) {
          issues.push(`Changed geometry or placement in ${group.id}, item ${instance.index+1}.`); intact = false;
        }
      });
      if (intact) complete++;
    }
    counts.push({group:group.id, required:group.quantity, complete});
  }
  for (const object of actual.objects)
    if (object.id.startsWith('inventory-') && !required.has(object.id)) issues.push('Unexpected repeated object.');
  if (JSON.stringify(actual.cameras) !== JSON.stringify(original.cameras)) issues.push('Saved cameras changed during inventory assembly.');
  if (JSON.stringify(actual.previewLights) !== JSON.stringify(original.previewLights)) issues.push('Preview lighting changed during inventory assembly.');
  const templates = new Set(specs.map(group => group.templateAnchorId));
  for (const object of original.objects.filter(item => !templates.has(item.anchorId)))
    if (JSON.stringify(byId.get(object.id)) !== JSON.stringify(object)) issues.push('An unrelated set object changed.');
  return {status:issues.length ? 'failed' : 'passed', counts, issues};
}
