/*!
 * LumiField Electronic Pet 2 integration.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Uses the official Bible Strong Avatar Lab Web Runtime by
 * Stéphane Montlouis-Calixte, fixed at commit
 * 175691ab32cefe5faec7828af62f3d50210a8eb2.
 * LumiField modifications are recorded in
 * docs/licenses/bible-strong-avatar-lab/MODIFICATIONS.md.
 */
import { createAvatar } from '../third_party/bible-strong-avatar-lab/packages/avatar-web/src/index.ts';
import baseDefinition from './lf-electronic-pet2.avatar.json';
import presetDocument from './lf-electronic-pet2-avatars.json';

const SOURCE_COMMIT = '175691ab32cefe5faec7828af62f3d50210a8eb2';
const SOURCE_REPOSITORY = 'https://github.com/smontlouis/bible-strong-avatar-lab';
const records = new WeakMap();
const runtime = {
  mounts: 0,
  unmounts: 0,
  configures: 0,
  definitionBuilds: 0,
  lastError: '',
};

const DEFAULTS = Object.freeze({
  avatarId: presetDocument.activeAvatarId || 'strobi',
  behaviorMode: 'animation',
  animation: 'idle',
  expression: 'neutral',
  blinking: true,
  ambientMovement: true,
  bodyColor: '',
  eyesColor: '',
});
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const animationKeys = Object.freeze(
  (baseDefinition.animationOrder || Object.keys(baseDefinition.animations || {})).slice(),
);
const expressionKeys = Object.freeze(
  (baseDefinition.expressionOrder || Object.keys(baseDefinition.expressions || {})).slice(),
);
const avatarPresets = Object.freeze((presetDocument.avatars || []).map(avatar => Object.freeze({
  id: avatar.id,
  name: avatar.name,
  bodyColor: avatar.colors.body,
  eyesColor: avatar.colors.eyes,
})));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function presetFor(id) {
  return (presetDocument.avatars || []).find(avatar => avatar.id === id) ||
    (presetDocument.avatars || [])[0];
}

function normalizeOptions(input = {}) {
  const requested = { ...DEFAULTS, ...input };
  const preset = presetFor(String(requested.avatarId || '')) || {};
  return {
    avatarId: String(preset.id || DEFAULTS.avatarId),
    behaviorMode: requested.behaviorMode === 'expression' ? 'expression' : 'animation',
    animation: animationKeys.includes(requested.animation) ? requested.animation : DEFAULTS.animation,
    expression: expressionKeys.includes(requested.expression) ? requested.expression : DEFAULTS.expression,
    blinking: requested.blinking !== false,
    ambientMovement: requested.ambientMovement !== false,
    bodyColor: HEX_COLOR.test(String(requested.bodyColor || ''))
      ? String(requested.bodyColor).toLowerCase()
      : String(preset.colors?.body || baseDefinition.colors.body).toLowerCase(),
    eyesColor: HEX_COLOR.test(String(requested.eyesColor || ''))
      ? String(requested.eyesColor).toLowerCase()
      : String(preset.colors?.eyes || baseDefinition.colors.eyes).toLowerCase(),
  };
}

function applyEyeDefaults(expression, eyes, baseEyes) {
  const mappings = [
    ['widthLeft', expression.eyes.left, 'width', 10],
    ['widthRight', expression.eyes.right, 'width', 10],
    ['heightLeft', expression.eyes.left, 'height', 10],
    ['heightRight', expression.eyes.right, 'height', 10],
    ['positionXLeft', expression.eyes.left, 'x'],
    ['positionXRight', expression.eyes.right, 'x'],
    ['positionYLeft', expression.eyes.left, 'y'],
    ['positionYRight', expression.eyes.right, 'y'],
    ['leftAngle', expression.eyes.left, 'angle'],
    ['rightAngle', expression.eyes.right, 'angle'],
    ['spacing', expression.eyes, 'spacing'],
  ];
  mappings.forEach(([field, target, property, minimum]) => {
    const delta = Number(eyes[field]) - Number(baseEyes[field]);
    const value = Number(target[property]) + (Number.isFinite(delta) ? delta : 0);
    target[property] = minimum === undefined ? value : Math.max(minimum, value);
  });
}

function buildDefinition(options) {
  const settings = normalizeOptions(options);
  const definition = clone(baseDefinition);
  const preset = presetFor(settings.avatarId);
  const baseEyes = presetDocument.baseEyeDefaults || {};
  definition.name = preset.name;
  definition.body = clone(preset.body);
  definition.colors = { body: settings.bodyColor, eyes: settings.eyesColor };

  Object.values(definition.expressions).forEach(expression => {
    applyEyeDefaults(expression, preset.eyes, baseEyes);
    expression.motion = expression.motion || { eyes: 'none', body: 'none' };
    if (settings.ambientMovement) {
      if (expression.motion.eyes === 'none') expression.motion.eyes = 'microSaccades';
      if (expression.motion.body === 'none') expression.motion.body = 'slowDrift';
    } else {
      expression.motion.eyes = 'none';
      expression.motion.body = 'none';
    }
  });

  const blinkTemplate = clone(definition.animations.idle?.blink || {
    enabled: true,
    initialDelayMs: 2600,
    minIntervalMs: 3600,
    maxIntervalMs: 6800,
    durationMs: 260,
  });
  Object.values(definition.animations).forEach(animation => {
    animation.blink.enabled = settings.blinking;
  });
  if (settings.behaviorMode === 'expression') {
    definition.animations = {};
    definition.animationOrder = [];
    expressionKeys.forEach(expression => {
      const key = `lf-expression-${expression}`;
      definition.animations[key] = {
        playbackMode: 'loop',
        steps: [{ expression, holdMs: 60000, transitionMs: 420, transition: 'smooth' }],
        blink: { ...blinkTemplate, enabled: settings.blinking },
        metadata: {
          label: expression,
          description: 'LumiField expression preview using the official Avatar Runtime.',
          group: 'LumiField',
        },
      };
      definition.animationOrder.push(key);
    });
  }
  runtime.definitionBuilds += 1;
  return { definition, settings };
}

function runtimeAnimation(settings) {
  return settings.behaviorMode === 'expression'
    ? `lf-expression-${settings.expression}`
    : settings.animation;
}

export function mount(host, options = {}) {
  if (!host || records.has(host)) return false;
  try {
    const built = buildDefinition(options.settings || options);
    const activeAnimation = runtimeAnimation(built.settings);
    const controller = createAvatar(host, {
      definition: built.definition,
      defaultAnimation: activeAnimation,
      autoplay: options.paused !== true,
      size: '100%',
      ariaLabel: `${built.definition.name} 电子宠物`,
      className: 'lf-electronic-pet2-avatar',
      onError(error) {
        runtime.lastError = String(error?.message || error || 'AVATAR_RUNTIME_ERROR');
      },
    });
    if (options.paused === true) controller.pause();
    records.set(host, {
      controller,
      settings: built.settings,
      activeAnimation,
      paused: options.paused === true,
      mountedAt: performance.now(),
    });
    host.dataset.petRuntime = 'bible-strong-avatar-web';
    host.dataset.petSourceCommit = SOURCE_COMMIT;
    runtime.mounts += 1;
    runtime.lastError = '';
    return true;
  } catch (error) {
    runtime.lastError = String(error?.message || error || 'AVATAR_RUNTIME_MOUNT_FAILED');
    return false;
  }
}

export function configure(host, input = {}) {
  const record = host ? records.get(host) : null;
  if (!record) return { ok: false, error: 'PET2_NOT_MOUNTED' };
  const next = normalizeOptions({ ...record.settings, ...input });
  const definitionChanged = ['avatarId', 'behaviorMode', 'blinking', 'ambientMovement', 'bodyColor', 'eyesColor']
    .some(field => next[field] !== record.settings[field]);
  if (definitionChanged) return { ok: false, requiresRemount: true };
  const activeAnimation = runtimeAnimation(next);
  const result = record.controller.play(activeAnimation);
  if (!result.ok) {
    runtime.lastError = String(result.error?.message || 'AVATAR_COMMAND_FAILED');
    return result;
  }
  record.settings = next;
  record.activeAnimation = activeAnimation;
  if (record.paused) record.controller.pause();
  runtime.configures += 1;
  runtime.lastError = '';
  return { ok: true };
}

export function setPaused(host, paused) {
  const record = host ? records.get(host) : null;
  if (!record) return false;
  const next = paused === true;
  if (record.paused === next) return true;
  record.paused = next;
  if (next) record.controller.pause();
  else record.controller.play(record.activeAnimation);
  return true;
}

export function unmount(host) {
  const record = host ? records.get(host) : null;
  if (!record) return false;
  record.controller.destroy();
  records.delete(host);
  delete host.dataset.petRuntime;
  delete host.dataset.petSourceCommit;
  runtime.unmounts += 1;
  return true;
}

export function getCapabilities() {
  return {
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit: SOURCE_COMMIT,
    package: '@bible-strong/avatar-web@0.1.0 source snapshot',
    schema: `${baseDefinition.schema}@${baseDefinition.schemaVersion}`,
    avatars: avatarPresets.map(value => ({ ...value })),
    animations: animationKeys.map(key => ({
      key,
      label: baseDefinition.animations[key]?.metadata?.label || key,
    })),
    expressions: expressionKeys.map(key => ({ key, label: key })),
    configurable: [
      'avatar',
      'animation',
      'expression',
      'blinking',
      'ambientMovement',
      'bodyColor',
      'eyesColor',
    ],
  };
}

export function getDebug(host) {
  const record = host ? records.get(host) : null;
  return {
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit: SOURCE_COMMIT,
    package: '@bible-strong/avatar-web@0.1.0 source snapshot',
    mounted: !!record,
    hostCount: host ? host.querySelectorAll('.bs-avatar').length : 0,
    svgCount: host ? host.querySelectorAll('svg[viewBox="-150 -150 300 300"]').length : 0,
    state: record ? record.controller.getState() : null,
    settings: record ? { ...record.settings } : null,
    activeAnimation: record?.activeAnimation || '',
    paused: !!record?.paused,
    mounts: runtime.mounts,
    unmounts: runtime.unmounts,
    configures: runtime.configures,
    definitionBuilds: runtime.definitionBuilds,
    lastError: runtime.lastError,
  };
}
