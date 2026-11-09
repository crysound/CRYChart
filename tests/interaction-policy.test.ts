import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveInteractionPolicy, getDragInteraction, getWheelInteraction, getDoubleClickInteraction, wheelAnchorFraction, axisAcceptsChartInteraction} from '../src/interaction-policy.js';

// Independently specified routing fixtures for the public settings consumed by
// OpenTest. These tests do not import, modify, or execute the application.
const defaults = {
  pan: {lmb: {drag: {x: true, y: false}}, wheel: false, rmb: false}, zoom: {wheel: false, y: false},
  xAxis: {zoom: {wheel: false}}, yAxis: {zoom: {wheel: false}}, rectangleZoom: false, restoreDefault: {doubleClick: false},
};
const wheel = {...defaults, zoom: {wheel: {x: true, y: false, stopScroll: true, sensitivity: .5}, y: false},
  xAxis: {zoom: {wheel: {mode: 'toward-pointer', stopScroll: true, sensitivity: .5}}}};
const rect = {pan: false, zoom: {wheel: false, y: false}, xAxis: {zoom: {wheel: false}, restoreDefault: {doubleClick: false}},
  yAxis: {zoom: {wheel: false}, restoreDefault: {doubleClick: false}}, rectangleZoom: {lmb: {x: true, y: true}, rmb: false}, restoreDefault: {doubleClick: false}};
const axisDefaults = {pan: false, zoom: {drag: false, wheel: false, rmb: false}, rectangleZoom: {lmb: {drag: {}}, rmb: false}, restoreDefault: {doubleClick: false}};
const axisWheel = {...axisDefaults, zoom: {...axisDefaults.zoom, wheel: {mode: 'toward-pointer', stopScroll: true, sensitivity: .5}}};

test('construction/default object preserves defaults; explicit undefined disables chart gestures', () => {
  for (const input of [null, true, {}]) {
    const policy = resolveInteractionPolicy(input);
    assert.equal(getDragInteraction(policy, {button: 0}).kind, 'rectangle-zoom');
    assert.equal(getDragInteraction(policy, {button: 2}).kind, 'pan');
    assert.equal(getDragInteraction(policy, {button: 0, shiftKey: true}).kind, 'pan');
    assert.equal(getWheelInteraction(policy, {deltaY: 100}).factor, 1.2);
    assert.equal(getDoubleClickInteraction(policy).kind, 'restore');
  }
  for (const input of [false, undefined]) {
    const disabled = resolveInteractionPolicy(input);
    assert.equal(getDragInteraction(disabled, {button: 0}).kind, 'none'); assert.equal(getWheelInteraction(disabled, {deltaY: 10}).kind, 'none');
    assert.equal(getDoubleClickInteraction(disabled).kind, 'none');
    assert.equal(getDragInteraction(disabled, {button: 0, shiftKey: true}).kind, 'none');
  }
  assert.equal(getWheelInteraction(resolveInteractionPolicy({}, {axis: 'x'}), {deltaY: 100}).kind, 'zoom');
  assert.equal(getWheelInteraction(resolveInteractionPolicy({}, {axis: 'x', axisConfig: undefined}), {deltaY: 100}).kind, 'none');
});

test('OpenTest default is left-drag X pan, with wheel, right pan, rectangle and default restore disabled', () => {
  const policy = resolveInteractionPolicy(defaults);
  assert.deepEqual(getDragInteraction(policy, {button: 0}), {kind: 'pan', x: true, y: false, stopScroll: true, sensitivity: 1});
  assert.equal(getDragInteraction(policy, {button: 0, shiftKey: true}).kind, 'pan');
  assert.equal(getDragInteraction(policy, {button: 2}).kind, 'none'); assert.equal(getWheelInteraction(policy, {deltaY: 80}).kind, 'none');
  assert.equal(getDoubleClickInteraction(policy).kind, 'none');
});

test('wheel configuration scales only X, honors sensitivity, and keeps axis settings in their own lane scope', () => {
  const plot = resolveInteractionPolicy(wheel), zoom = getWheelInteraction(plot, {deltaY: 100});
  assert.deepEqual(zoom, {kind: 'zoom', x: true, y: false, stopScroll: true, sensitivity: .5, mode: 'toward-pointer', factor: 1.1});
  const xLane = resolveInteractionPolicy(wheel, {axis: 'x'}), yLane = resolveInteractionPolicy(wheel, {axis: 'y'});
  assert.equal(getWheelInteraction(xLane, {deltaY: 100}).kind, 'zoom'); assert.equal(getWheelInteraction(yLane, {deltaY: 100}).kind, 'none');
  const individualY = resolveInteractionPolicy(wheel, {axis: 'y', axisConfig: axisWheel});
  assert.deepEqual(getWheelInteraction(individualY, {deltaY: -100}), {kind: 'zoom', x: false, y: true, stopScroll: true, sensitivity: .5, mode: 'toward-pointer', factor: .9});
});

test('rectangle configuration routes a left XY selection without enabling pan or wheel', () => {
  const policy = resolveInteractionPolicy(rect);
  assert.deepEqual(getDragInteraction(policy, {button: 0}), {kind: 'rectangle-zoom', x: true, y: true, stopScroll: true, sensitivity: 1});
  assert.equal(getDragInteraction(policy, {button: 2}).kind, 'none'); assert.equal(getDragInteraction(policy, {button: 0, shiftKey: true}).kind, 'rectangle-zoom');
  assert.equal(getWheelInteraction(policy, {deltaY: 1}).kind, 'none'); assert.equal(getDoubleClickInteraction(policy).kind, 'none');
});

test('axis drag nesting and per-axis overrides do not disable independent chart-area panning', () => {
  const x = resolveInteractionPolicy(defaults, {axis: 'x', axisConfig: axisDefaults}), y = resolveInteractionPolicy(defaults, {axis: 'y', axisConfig: axisDefaults});
  assert.deepEqual(getDragInteraction(x, {button: 0}), {kind: 'rectangle-zoom', x: true, y: false, stopScroll: true, sensitivity: 1});
  assert.equal(getDragInteraction(y, {button: 0}).x, false); assert.equal(getDragInteraction(y, {button: 0}).y, true);
  assert.equal(getWheelInteraction(x, {deltaY: 1}).kind, 'none'); assert.equal(getDoubleClickInteraction(x).kind, 'none');
  assert.equal(axisAcceptsChartInteraction(axisDefaults, 'pan'), true);
  assert.equal(axisAcceptsChartInteraction({...axisDefaults, chartInteractions: {pan: false}}, 'pan'), false);
  assert.equal(axisAcceptsChartInteraction({...axisDefaults, chartInteractions: {pan: false}}, 'zoom'), true);
  assert.equal(axisAcceptsChartInteraction({chartInteractions: false}, 'rectangleZoom'), false);
  assert.equal(axisAcceptsChartInteraction(false, 'pan'), false);
});

test('axes-wide settings are refined by direction then local axis, and snapshots do not borrow mutable input', () => {
  const input = {axes: {zoom: {wheel: {mode: 'centered', sensitivity: 2}}}, xAxis: {zoom: {wheel: {mode: 'keep-start'}}}};
  const x = resolveInteractionPolicy(input, {axis: 'x', axisConfig: {zoom: {wheel: {sensitivity: .25, stopScroll: false}}}});
  input.axes.zoom.wheel.sensitivity = 50; input.xAxis.zoom.wheel.mode = 'keep-end';
  const result = getWheelInteraction(x, {deltaY: 100});
  assert.equal(result.mode, 'keep-start'); assert.equal(result.sensitivity, .25); assert.equal(result.stopScroll, false); assert.equal(result.factor, 1.05);
  assert.ok(Object.isFrozen(x.config)); assert.ok(Object.isFrozen(x.config.zoom.wheel));
  const plot = resolveInteractionPolicy({axes: {zoom: {wheel: false}}}); assert.equal(getWheelInteraction(plot, {deltaY: 1}).kind, 'zoom');
});

test('wheel anchor modes retain endpoints and centered zoom without treating stopScroll as browser prevention', () => {
  assert.equal(wheelAnchorFraction('toward-pointer', .2), .2); assert.equal(wheelAnchorFraction('toward-pointer', -2), 0);
  assert.equal(wheelAnchorFraction('centered', .2), .5); assert.equal(wheelAnchorFraction('keep-start', .8), 0); assert.equal(wheelAnchorFraction('keep-end', .2), 1);
  const rule = getWheelInteraction(resolveInteractionPolicy({zoom: {wheel: {stopScroll: false}}}), {deltaY: 20});
  assert.equal(rule.kind, 'zoom'); assert.equal(rule.stopScroll, false); assert.ok(!('preventDefault' in rule));
});

test('wheel deltas and disabled dimensions do not create invalid intervals or fake actions', () => {
  const p = resolveInteractionPolicy({zoom: {wheel: {sensitivity: 0}}}); assert.equal(getWheelInteraction(p, {deltaY: 100}).kind, 'none');
  const bothOff = resolveInteractionPolicy({zoom: {wheel: {x: false, y: false}}}); assert.equal(getWheelInteraction(bothOff, {deltaY: 100}).kind, 'none');
  const normal = resolveInteractionPolicy({});
  assert.equal(getWheelInteraction(normal, {deltaY: NaN}).kind, 'none'); assert.equal(getWheelInteraction(normal, {deltaY: 0}).factor, 1);
  assert.equal(getWheelInteraction(normal, {deltaY: 1, deltaMode: 1}).factor, 1.2);
  assert.equal(getWheelInteraction(normal, {deltaY: 1, deltaMode: 2}, 400).factor, 1.2);
  assert.equal(getWheelInteraction(normal, {deltaY: 1e100}).factor, 1.2);
  assert.throws(() => getWheelInteraction(normal, {deltaY: 1, deltaMode: 9}), /delta mode/);
});

test('public directional wheel observations are independent of delta magnitude and units', () => {
  // Fixed factors keep expected values independent of the production calculation.
  const observations = [[.25, .95, 1.05], [.5, .9, 1.1], [1, .8, 1.2], [2, .6, 1.4], [4, .2, 1.8]];
  for (const [sensitivity, inward, outward] of observations) {
    const policy = resolveInteractionPolicy({zoom: {wheel: {sensitivity}}});
    for (const magnitude of [1, 10, 100, 1000, 1750]) for (const deltaMode of [0, 1, 2]) {
      assert.ok(Math.abs(getWheelInteraction(policy, {deltaY: -magnitude!, deltaMode}).factor - inward!) < 1e-15);
      assert.ok(Math.abs(getWheelInteraction(policy, {deltaY: magnitude!, deltaMode}).factor - outward!) < 1e-15);
    }
  }
});

test('wheel cannot collapse or reverse the current interval at excessive inward sensitivity', () => {
  for (const sensitivity of [5, 10, Number.MAX_VALUE]) {
    const policy = resolveInteractionPolicy({zoom: {wheel: {sensitivity}}});
    const inward = getWheelInteraction(policy, {deltaY: -100});
    assert.equal(inward.kind, 'none'); assert.equal(inward.factor, 1);
  }
  assert.equal(getWheelInteraction(resolveInteractionPolicy({zoom: {wheel: {sensitivity: 5}}}), {deltaY: 100}).factor, 2);
  assert.equal(getWheelInteraction(resolveInteractionPolicy({zoom: {wheel: {sensitivity: 10}}}), {deltaY: 100}).factor, 3);
});

test('unsupported enabled gestures and callbacks are explicit, while disabled legacy fields are harmless', () => {
  for (const input of [{zoom: {pinch: {}}}, {zoom: {drag: {}}}, {pan: {wheel: {}}}, {paginate: {forward: {code: 'ArrowRight'}}},
    {restorePrevious: {}}, {rectangleZoom: {start() {}}}, {pan: {ctrl: {drag: {}}}}, {pan: {cursor: 'move'}}]) {
    assert.throws(() => resolveInteractionPolicy(input), /CRYChart does not yet implement interaction/);
  }
  assert.doesNotThrow(() => resolveInteractionPolicy({zoom: {drag: false, pinch: false}, pan: {wheel: false}, paginate: false, restorePrevious: false}));
  assert.throws(() => resolveInteractionPolicy({zoom: {wheel: {sensitivity: Infinity}}}), /finite nonnegative/);
  assert.throws(() => resolveInteractionPolicy({zoom: {wheel: {mode: 'unknown'}}}), /interaction/);
  assert.throws(() => resolveInteractionPolicy({zoom: {lmb: {wheel: {}}}}), /interaction zoom.lmb/);
  const cyclic: any = {}; cyclic.axes = cyclic; assert.throws(() => resolveInteractionPolicy(cyclic), /cyclic/);
});

test('same-button conflicting explicit gestures are rejected rather than silently selecting an operation', () => {
  const policy = resolveInteractionPolicy({pan: {lmb: {drag: {}}}, rectangleZoom: {lmb: {x: true}}});
  assert.throws(() => getDragInteraction(policy, {button: 0}), /simultaneous pan and rectangle/);
  assert.equal(getDragInteraction(resolveInteractionPolicy({}), {button: 1}).kind, 'none');
});

test('a button property override preserves a disabled drag until the drag itself is explicitly re-enabled', () => {
  const disabled = resolveInteractionPolicy({pan: {drag: false, lmb: {x: true}}, rectangleZoom: false});
  assert.equal(getDragInteraction(disabled, {button: 0}).kind, 'none');
  const enabled = resolveInteractionPolicy({pan: {drag: false, lmb: {drag: {x: true, y: false}}}, rectangleZoom: false});
  assert.equal(getDragInteraction(enabled, {button: 0}).kind, 'pan');
});
