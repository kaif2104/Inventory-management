const isNonNegInt = v => Number.isInteger(v) && v >= 0;

function parseId(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function str(body, key, { required = false, max = 120 } = {}, errors, out) {
  const v = body[key];
  if (v === undefined) { if (required) errors.push(`${key} is required`); return; }
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) {
    errors.push(`${key} must be a non-empty string up to ${max} chars`); return;
  }
  out[key] = v.trim();
}

// create: sku + name required; update: at least one editable field
function validateProduct(body = {}, { partial = false } = {}) {
  const errors = [];
  const out = {};
  if (!partial) str(body, 'sku', { required: true, max: 64 }, errors, out);
  str(body, 'name', { required: !partial }, errors, out);
  str(body, 'category', { max: 60 }, errors, out);

  if (body.price !== undefined) {
    if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0) errors.push('price must be a number >= 0');
    else out.price = Math.round(body.price * 100) / 100;
  }
  if (body.reorder_level !== undefined) {
    if (!isNonNegInt(body.reorder_level)) errors.push('reorder_level must be an integer >= 0');
    else out.reorder_level = body.reorder_level;
  }
  if (!partial && body.quantity !== undefined) {
    if (!isNonNegInt(body.quantity)) errors.push('quantity must be an integer >= 0');
    else out.quantity = body.quantity;
  }
  if (partial && !errors.length && !Object.keys(out).length) errors.push('no editable fields provided');
  return { errors, value: out };
}

function validateMovement(body = {}) {
  const errors = [];
  if (!['in', 'out', 'adjust'].includes(body.type)) errors.push("type must be 'in', 'out' or 'adjust'");
  if (!Number.isInteger(body.quantity) || body.quantity < 0 || (body.type !== 'adjust' && body.quantity === 0)) {
    errors.push(body.type === 'adjust' ? 'quantity must be an integer >= 0' : 'quantity must be an integer > 0');
  }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 255)) errors.push('note must be a string up to 255 chars');
  return { errors, value: { type: body.type, quantity: body.quantity, note: body.note || null } };
}

module.exports = { parseId, validateProduct, validateMovement };
