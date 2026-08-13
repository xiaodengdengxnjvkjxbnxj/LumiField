/*
 * LumiField Motion
 * Copyright (C) 2026 LumiField contributors
 *
 * A small, dependency-free animation runtime written for LumiField. It only
 * implements the animation surface used by the application and is distributed
 * with LumiField under GPL-3.0-only.
 */
(function (global) {
  'use strict';

  var active = new Set();
  var registry = new WeakMap();
  var transformStates = new WeakMap();
  var frameId = 0;
  var reserved = {
    duration: 1, delay: 1, ease: 1, stagger: 1, overwrite: 1, force3D: 1,
    repeat: 1, repeatDelay: 1, yoyo: 1, onStart: 1, onUpdate: 1,
    onComplete: 1, callbackScope: 1, clearProps: 1
  };

  function now() {
    return global.performance && global.performance.now ? global.performance.now() : Date.now();
  }

  function requestTick() {
    if (!frameId && active.size) frameId = global.requestAnimationFrame(tick);
  }

  function tick(time) {
    frameId = 0;
    Array.from(active).forEach(function (unit) { unit.render(time); });
    requestTick();
  }

  function flattenTargets(value, output) {
    if (value == null) return output;
    if (typeof value === 'string') {
      Array.prototype.forEach.call(document.querySelectorAll(value), function (item) {
        output.push(item);
      });
      return output;
    }
    if (Array.isArray(value) || (typeof value !== 'function' && !value.nodeType &&
        typeof value.length === 'number' && typeof value !== 'string')) {
      Array.prototype.forEach.call(value, function (item) { flattenTargets(item, output); });
      return output;
    }
    output.push(value);
    return output;
  }

  function targetsOf(value) {
    return flattenTargets(value, []);
  }

  function isElement(target) {
    return !!(target && target.nodeType === 1 && target.style);
  }

  function transformState(target) {
    var state = transformStates.get(target);
    if (!state) {
      state = {
        x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, rotation: 0
      };
      var computed = global.getComputedStyle ? global.getComputedStyle(target).transform : '';
      var values;
      if (computed && computed.indexOf('matrix3d(') === 0) {
        values = computed.slice(9, -1).split(',').map(Number);
        if (values.length === 16 && values.every(isFinite)) {
          state.x = values[12];
          state.y = values[13];
          state.z = values[14];
          state.scaleX = Math.hypot(values[0], values[1], values[2]) || 1;
          state.scaleY = Math.hypot(values[4], values[5], values[6]) || 1;
          state.rotation = Math.atan2(values[1], values[0]) * 180 / Math.PI;
        }
      } else if (computed && computed.indexOf('matrix(') === 0) {
        values = computed.slice(7, -1).split(',').map(Number);
        if (values.length === 6 && values.every(isFinite)) {
          state.x = values[4];
          state.y = values[5];
          state.scaleX = Math.hypot(values[0], values[1]) || 1;
          state.scaleY = Math.abs(values[0] * values[3] - values[1] * values[2]) / state.scaleX || 1;
          state.rotation = Math.atan2(values[1], values[0]) * 180 / Math.PI;
        }
      }
      transformStates.set(target, state);
    }
    return state;
  }

  function renderTransform(target, state) {
    var generated = 'translate3d(' + state.x + 'px,' + state.y + 'px,' + state.z + 'px)' +
      ' rotate(' + state.rotation + 'deg) scale(' + state.scaleX + ',' + state.scaleY + ')';
    target.style.transform = generated;
  }

  function transformName(name) {
    return name === 'rotate' ? 'rotation' : name;
  }

  function isTransformProperty(name) {
    name = transformName(name);
    return name === 'x' || name === 'y' || name === 'z' || name === 'scale' ||
      name === 'scaleX' || name === 'scaleY' || name === 'rotation';
  }

  function cssName(name) {
    return name.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); });
  }

  function readCss(target, name) {
    var inline = target.style[name];
    if (inline) return inline;
    var computed = global.getComputedStyle ? global.getComputedStyle(target) : null;
    return computed ? (computed[name] || computed.getPropertyValue(cssName(name))) : '';
  }

  function readValue(target, name) {
    if (isElement(target)) {
      if (isTransformProperty(name)) {
        var state = transformState(target);
        name = transformName(name);
        if (name === 'scale') return state.scaleX;
        return state[name];
      }
      if (name === 'autoAlpha') return parseFloat(readCss(target, 'opacity')) || 0;
      if (name === 'scrollTop') return target.scrollTop;
      if (name in target.style || name === 'opacity' || name === 'filter' ||
          name === 'boxShadow' || name === 'display' || name === 'visibility') {
        return readCss(target, name);
      }
    }
    return target[name];
  }

  function writeValue(target, name, value) {
    if (isElement(target)) {
      if (isTransformProperty(name)) {
        var state = transformState(target);
        name = transformName(name);
        value = Number(value);
        if (!isFinite(value)) return;
        if (name === 'scale') state.scaleX = state.scaleY = value;
        else state[name] = value;
        renderTransform(target, state);
        return;
      }
      if (name === 'autoAlpha') {
        var opacity = Number(value);
        target.style.opacity = String(opacity);
        target.style.visibility = opacity <= 0.0001 ? 'hidden' : 'visible';
        return;
      }
      if (name === 'scrollTop') {
        target.scrollTop = Number(value);
        return;
      }
      if (name in target.style || name === 'opacity' || name === 'filter' ||
          name === 'boxShadow' || name === 'display' || name === 'visibility') {
        target.style[name] = String(value);
        return;
      }
    }
    target[name] = value;
  }

  function clearProperties(target, properties) {
    if (!isElement(target) || properties == null) return;
    var names = properties === true || properties === 'all'
      ? ['transform', 'opacity', 'visibility', 'filter', 'boxShadow', 'display']
      : String(properties).split(',');
    names.forEach(function (rawName) {
      var name = rawName.trim();
      if (!name) return;
      if (name === 'transform' || isTransformProperty(name)) {
        target.style.removeProperty('transform');
        transformStates.delete(target);
      } else if (name === 'autoAlpha') {
        target.style.removeProperty('opacity');
        target.style.removeProperty('visibility');
      } else {
        target.style.removeProperty(cssName(name));
      }
    });
  }

  function numericParts(value) {
    var text = String(value == null ? '' : value);
    var matches = text.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
    return { text: text, numbers: matches.map(Number) };
  }

  function splitTopLevel(value) {
    var parts = [];
    var start = 0;
    var depth = 0;
    var text = String(value);
    for (var index = 0; index < text.length; index++) {
      if (text[index] === '(') depth++;
      else if (text[index] === ')') depth = Math.max(0, depth - 1);
      else if (text[index] === ',' && depth === 0) {
        parts.push(text.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(text.slice(start).trim());
    return parts;
  }

  function normalizeShadowPair(fromValue, toValue, name) {
    if (name !== 'boxShadow') return [fromValue, toValue];
    var fromLayers = splitTopLevel(fromValue);
    var toLayers = splitTopLevel(toValue);
    while (fromLayers.length < toLayers.length) {
      var missingIndex = toLayers.length - fromLayers.length - 1;
      fromLayers.unshift(toLayers[missingIndex].replace(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi, '0'));
    }
    while (toLayers.length < fromLayers.length) {
      toLayers.push(fromLayers[toLayers.length].replace(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi, '0'));
    }
    return [fromLayers.join(', '), toLayers.join(', ')];
  }

  function interpolator(fromValue, toValue, name) {
    if (typeof toValue === 'number' && typeof fromValue === 'number') {
      return function (progress) { return fromValue + (toValue - fromValue) * progress; };
    }

    var toNumber = typeof toValue === 'number' ? toValue : Number(toValue);
    var fromNumber = typeof fromValue === 'number' ? fromValue : Number(fromValue);
    if (isFinite(toNumber) && isFinite(fromNumber) && String(toValue).trim() !== '') {
      return function (progress) { return fromNumber + (toNumber - fromNumber) * progress; };
    }

    var normalized = normalizeShadowPair(fromValue, toValue, name);
    var start = numericParts(normalized[0]);
    var end = numericParts(normalized[1]);
    if (!start.numbers.length && end.numbers.length && /^(none|normal|)$/i.test(start.text.trim())) {
      start.numbers = end.numbers.map(function () { return 0; });
    }
    if (start.numbers.length === end.numbers.length && end.numbers.length) {
      return function (progress) {
        var index = 0;
        return end.text.replace(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi, function () {
          var value = start.numbers[index] + (end.numbers[index] - start.numbers[index]) * progress;
          index++;
          return String(Math.round(value * 100000) / 100000);
        });
      };
    }
    return function (progress) { return progress < 1 ? fromValue : toValue; };
  }

  function easeFunction(value) {
    if (typeof value === 'function') return value;
    var text = String(value || 'linear').toLowerCase();
    var mode = text.indexOf('.inout') >= 0 ? 'inOut' : (text.indexOf('.in') >= 0 ? 'in' : 'out');
    var base;
    var powerMatch = text.match(/power(\d)/);
    if (powerMatch) {
      var exponent = Number(powerMatch[1]) + 1;
      base = function (p) { return Math.pow(p, exponent); };
    } else if (text.indexOf('sine') === 0) {
      base = function (p) { return 1 - Math.cos(p * Math.PI / 2); };
    } else if (text.indexOf('expo') === 0) {
      base = function (p) { return p === 0 ? 0 : Math.pow(2, 10 * (p - 1)); };
    } else if (text.indexOf('back') === 0) {
      var backMatch = text.match(/\(([^)]+)\)/);
      var overshoot = backMatch ? Number(backMatch[1]) : 1.70158;
      base = function (p) { return p * p * ((overshoot + 1) * p - overshoot); };
    } else if (text.indexOf('elastic') === 0) {
      var elasticMatch = text.match(/\(([^,]+),\s*([^)]+)\)/);
      var amplitude = elasticMatch ? Math.max(1, Number(elasticMatch[1]) || 1) : 1;
      var period = elasticMatch ? Number(elasticMatch[2]) || 0.3 : 0.3;
      var phase = period / (2 * Math.PI) * Math.asin(1 / amplitude);
      var elasticOut = function (p) {
        if (p === 0 || p === 1) return p;
        return amplitude * Math.pow(2, -10 * p) * Math.sin((p - phase) * 2 * Math.PI / period) + 1;
      };
      if (mode === 'out') return elasticOut;
      if (mode === 'in') return function (p) { return 1 - elasticOut(1 - p); };
      return function (p) { return p < 0.5 ? (1 - elasticOut(1 - p * 2)) / 2 : (1 + elasticOut(p * 2 - 1)) / 2; };
    } else {
      base = function (p) { return p; };
    }
    if (text === 'linear' || text === 'none') return base;
    if (mode === 'in') return base;
    if (mode === 'inOut') {
      return function (p) { return p < 0.5 ? base(p * 2) / 2 : 1 - base((1 - p) * 2) / 2; };
    }
    return function (p) { return 1 - base(1 - p); };
  }

  function propertyNames(vars) {
    return Object.keys(vars || {}).filter(function (name) { return !reserved[name]; });
  }

  function trackMatches(track, names) {
    if (!names) return true;
    return track.names.some(function (name) {
      return names.indexOf(name) >= 0 ||
        (name === 'scale' && (names.indexOf('scaleX') >= 0 || names.indexOf('scaleY') >= 0)) ||
        ((name === 'scaleX' || name === 'scaleY') && names.indexOf('scale') >= 0) ||
        (name === 'rotation' && names.indexOf('rotate') >= 0) ||
        (name === 'rotate' && names.indexOf('rotation') >= 0);
    });
  }

  function register(unit) {
    var units = registry.get(unit.target);
    if (!units) {
      units = new Set();
      registry.set(unit.target, units);
    }
    units.add(unit);
    active.add(unit);
    requestTick();
  }

  function unregister(unit) {
    active.delete(unit);
    var units = registry.get(unit.target);
    if (units) {
      units.delete(unit);
      if (!units.size) registry.delete(unit.target);
    }
  }

  function killTarget(target, names, except, skipFuture) {
    var units = registry.get(target);
    if (!units) return;
    Array.from(units).forEach(function (unit) {
      if (unit === except) return;
      if (skipFuture && !unit.started && unit.startAt > except.startAt) return;
      unit.remove(names);
    });
  }

  function Unit(target, fromVars, toVars, delayMs, group, index) {
    this.target = target;
    this.fromVars = fromVars;
    this.toVars = toVars;
    this.group = group;
    this.index = index;
    this.startAt = now() + delayMs;
    this.duration = Math.max(0, Number(toVars.duration) || 0) * 1000;
    this.repeat = Math.max(0, Math.floor(Number(toVars.repeat) || 0));
    this.repeatDelay = Math.max(0, Number(toVars.repeatDelay) || 0) * 1000;
    this.yoyo = !!toVars.yoyo;
    this.ease = easeFunction(toVars.ease);
    this.tracks = null;
    this.removedNames = [];
    this.started = false;
    this.finished = false;
    register(this);
  }

  Unit.prototype.prepare = function () {
    if (this.tracks) return;
    var self = this;
    var names = propertyNames(this.toVars);
    if (this.toVars.overwrite === true) killTarget(this.target, null, this, true);
    else if (this.toVars.overwrite === 'auto') killTarget(this.target, names, this, true);
    this.tracks = names.filter(function (name) {
      return !trackMatches({ names: [transformName(name), name] }, self.removedNames);
    }).map(function (name) {
      var end = typeof self.toVars[name] === 'function'
        ? self.toVars[name](self.index, self.target)
        : self.toVars[name];
      var start = self.fromVars && Object.prototype.hasOwnProperty.call(self.fromVars, name)
        ? self.fromVars[name]
        : readValue(self.target, name);
      return { names: [transformName(name), name], name: name, interpolate: interpolator(start, end, name) };
    });
  };

  Unit.prototype.render = function (time) {
    if (this.finished || time < this.startAt) return;
    this.prepare();
    if (!this.started) {
      this.started = true;
      if (typeof this.toVars.onStart === 'function') {
        this.toVars.onStart.call(this.toVars.callbackScope || this.target);
      }
    }

    var elapsed = Math.max(0, time - this.startAt);
    var cycleLength = this.duration + this.repeatDelay;
    var totalLength = this.duration * (this.repeat + 1) + this.repeatDelay * this.repeat;
    var complete = this.duration === 0 || elapsed >= totalLength;
    var cycle = cycleLength ? Math.min(this.repeat, Math.floor(elapsed / cycleLength)) : this.repeat;
    var cycleElapsed = complete ? this.duration : Math.min(this.duration, elapsed - cycle * cycleLength);
    var progress = this.duration ? cycleElapsed / this.duration : 1;
    if (this.yoyo && cycle % 2) progress = 1 - progress;
    var eased = this.ease(Math.max(0, Math.min(1, progress)));
    this.tracks.forEach(function (track) {
      writeValue(this.target, track.name, track.interpolate(eased));
    }, this);
    if (typeof this.toVars.onUpdate === 'function') {
      this.toVars.onUpdate.call(this.toVars.callbackScope || this.target);
    }
    if (complete) this.finish(true);
  };

  Unit.prototype.remove = function (names) {
    if (this.finished) return;
    if (!names) {
      this.finish(false);
      return;
    }
    if (!this.tracks) {
      var planned = propertyNames(this.toVars);
      var matched = planned.filter(function (name) {
        return trackMatches({ names: [transformName(name), name] }, names);
      });
      if (!matched.length) return;
      this.removedNames = this.removedNames.concat(names);
      if (matched.length === planned.length) this.finish(false);
      return;
    }
    this.tracks = this.tracks.filter(function (track) { return !trackMatches(track, names); });
    if (!this.tracks.length) this.finish(false);
  };

  Unit.prototype.finish = function (natural) {
    if (this.finished) return;
    this.finished = true;
    unregister(this);
    if (natural) clearProperties(this.target, this.toVars.clearProps);
    this.group.unitDone(this, natural);
  };

  function Group(vars) {
    this.vars = vars || {};
    this.units = [];
    this.remaining = 0;
    this.cancelled = false;
    this.completed = false;
  }

  Group.prototype.add = function (unit) {
    this.units.push(unit);
    this.remaining++;
  };

  Group.prototype.unitDone = function (_unit, natural) {
    if (!natural) this.cancelled = true;
    this.remaining--;
    if (!this.remaining && !this.completed) {
      this.completed = true;
      if (!this.cancelled && typeof this.vars.onComplete === 'function') {
        this.vars.onComplete.call(this.vars.callbackScope || null);
      }
    }
  };

  Group.prototype.kill = function () {
    this.cancelled = true;
    this.units.slice().forEach(function (unit) { unit.finish(false); });
    return this;
  };

  function setValues(targets, vars) {
    targetsOf(targets).forEach(function (target, index) {
      propertyNames(vars).forEach(function (name) {
        var value = typeof vars[name] === 'function' ? vars[name](index, target) : vars[name];
        writeValue(target, name, value);
      });
      clearProperties(target, vars.clearProps);
    });
  }

  function animate(targets, fromVars, toVars, baseDelay) {
    toVars = toVars || {};
    var list = targetsOf(targets);
    var group = new Group(toVars);
    var stagger = Math.max(0, Number(toVars.stagger) || 0);
    var delay = Math.max(0, Number(toVars.delay) || 0) + (baseDelay || 0);
    if (fromVars) setValues(list, fromVars);
    list.forEach(function (target, index) {
      group.add(new Unit(target, fromVars, toVars, (delay + stagger * index) * 1000, group, index));
    });
    if (!list.length) {
      group.completed = true;
      if (typeof toVars.onComplete === 'function') toVars.onComplete.call(toVars.callbackScope || null);
    }
    return group;
  }

  function mergeDefaults(defaults, vars) {
    var output = {};
    Object.keys(defaults || {}).forEach(function (key) { output[key] = defaults[key]; });
    Object.keys(vars || {}).forEach(function (key) { output[key] = vars[key]; });
    return output;
  }

  function Timeline(options) {
    this.options = options || {};
    this.defaults = this.options.defaults || {};
    this.cursor = Math.max(0, Number(this.options.delay) || 0);
    this.handles = [];
  }

  Timeline.prototype.fromTo = function (targets, fromVars, toVars) {
    var vars = mergeDefaults(this.defaults, toVars);
    this.handles.push(animate(targets, fromVars, vars, this.cursor));
    this.cursor += Math.max(0, Number(vars.delay) || 0) +
      Math.max(0, Number(vars.duration) || 0) * (Math.max(0, Math.floor(Number(vars.repeat) || 0)) + 1) +
      Math.max(0, Number(vars.repeatDelay) || 0) * Math.max(0, Math.floor(Number(vars.repeat) || 0));
    return this;
  };

  Timeline.prototype.to = function (targets, vars) {
    vars = mergeDefaults(this.defaults, vars);
    this.handles.push(animate(targets, null, vars, this.cursor));
    this.cursor += Math.max(0, Number(vars.delay) || 0) +
      Math.max(0, Number(vars.duration) || 0) * (Math.max(0, Math.floor(Number(vars.repeat) || 0)) + 1) +
      Math.max(0, Number(vars.repeatDelay) || 0) * Math.max(0, Math.floor(Number(vars.repeat) || 0));
    return this;
  };

  Timeline.prototype.kill = function () {
    this.handles.forEach(function (handle) { handle.kill(); });
    return this;
  };

  var motion = {
    to: function (targets, vars) { return animate(targets, null, vars, 0); },
    fromTo: function (targets, fromVars, toVars) { return animate(targets, fromVars || {}, toVars || {}, 0); },
    set: function (targets, vars) {
      setValues(targets, vars || {});
      return { kill: function () {} };
    },
    killTweensOf: function (targets, properties) {
      var names = properties == null ? null : (Array.isArray(properties)
        ? properties.map(transformName)
        : String(properties).split(',').map(function (name) { return transformName(name.trim()); }));
      targetsOf(targets).forEach(function (target) { killTarget(target, names, null); });
    },
    delayedCall: function (delay, callback) {
      var killed = false;
      var timer = global.setTimeout(function () {
        if (!killed && typeof callback === 'function') callback();
      }, Math.max(0, Number(delay) || 0) * 1000);
      return {
        kill: function () {
          killed = true;
          global.clearTimeout(timer);
        }
      };
    },
    timeline: function (options) { return new Timeline(options); }
  };

  global.LumiFieldMotion = motion;
  global.gsap = motion;
})(window);
