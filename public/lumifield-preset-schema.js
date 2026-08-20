(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LumiFieldCanonicalPresetSchema = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TYPE = 'lumifield-canonical-preset';
  var SCHEMA = 'lumifield-canonical-preset';
  var VERSION = 1;
  var EFFECT_SCHEMA_VERSION = 1;
  var DANGEROUS = { '__proto__':1, prototype:1, constructor:1 };
  var META = {
    type:1, schema:1, version:1, schemaversion:1, presetid:1, id:1, name:1,
    title:1, presetname:1, createdat:1, updatedat:1, savedat:1, exportedat:1,
    appversion:1, visualpresetschema:1, desktoplyricsschema:1
  };
  var WRAPPERS = { snapshot:1, fx:1, data:1, settings:1, configuration:1, config:1 };
  var NAMESPACE_ALIASES = {
    visual:'visual', visuals:'visual', appearance:'visual', scene:'visual', display:'visual',
    particles:'particles', particle:'particles', particlesettings:'particles',
    lyrics:'lyrics', lyric:'lyrics', lyricsettings:'lyrics', lyricssettings:'lyrics',
    spectrum:'spectrum', visualizer:'spectrum', audiospectrum:'spectrum', spectrumsettings:'spectrum',
    echo:'echo', echoterrain:'echo', audioterrain:'echo', sonicterrain:'echo', echosettings:'echo',
    camera:'camera', view:'camera', camerasettings:'camera',
    glass:'glass', liquidglass:'glass', glasssettings:'glass',
    player:'player', controller:'player', playersettings:'player'
  };

  function number(min, max, integer) { return { type:'number', min:min, max:max, integer:!!integer }; }
  function bool(strict) { return { type:'boolean', strict:!!strict }; }
  function color() { return { type:'color' }; }
  function string(max) { return { type:'string', max:max || 80 }; }
  function enumeration(values, aliases) { return { type:'enum', values:values, aliases:aliases || {} }; }
  function numberArray(length, min, max) { return { type:'numberArray', length:length, min:min, max:max }; }
  function strictNumber(min, max, integer) { return { type:'number', min:min, max:max, integer:!!integer, strict:true }; }
  function arrayOf(item, options) {
    options = options || {};
    return { type:'array', item:item, length:options.length, minLength:options.minLength, maxLength:options.maxLength };
  }
  function tuple(items) { return { type:'tuple', items:items }; }
  function objectOf(fields, required) { return { type:'object', fields:fields, required:required || [] }; }
  function numberOr(values, min, max) { return { type:'numberOr', values:values || [], min:min, max:max }; }

  var SPECS = {
    visual: {
      preset:number(0, 6, true), intensity:number(0, 4), cinemaShake:number(0, 4), depth:number(0, 4), coverResolution:number(.25, 2),
      visualTintMode:enumeration(['auto','custom']), visualTintColor:color(), uiAccentColor:color(), homeAccentColor:color(), homeIconColor:color(), visualIconColor:color(),
      backgroundColorMode:enumeration(['cover','custom']), backgroundColor:color(), backgroundOpacity:number(0,1),
      shelf:enumeration(['off','side','stage']), shelfCameraMode:enumeration(['dynamic','static']), shelfPresence:enumeration(['auto','always']),
      shelfShowPodcasts:bool(), shelfMergeCollections:bool(), shelfAngleYManual:bool(),
      shelfSize:number(.58,1.75), shelfOffsetX:number(-1.2,1.2), shelfOffsetY:number(-.9,.9), shelfOffsetZ:number(-.9,.9), shelfAngleY:number(-30,30),
      shelfOpacity:number(.25,1), shelfBgOpacity:number(.25,.98), shelfAccentColor:color()
    },
    particles: {
      point:number(0,8), speed:number(-8,8), twist:number(0,4), color:number(0,4), scatter:number(0,4), bgFade:number(0,2), bloomStrength:number(0,4),
      floatLayer:bool(), cinema:bool(), edge:bool(), depthDistribution:bool(), bloom:bool(), lyricGlow:bool(), lyricGlowBeat:bool(), lyricGlowParticles:bool(), particleLyrics:bool(), backCover:bool()
    },
    lyrics: {
      translate:bool(),
      lyricGlowStrength:number(0,.85), lyricScale:number(.35,1.65), lyricOffsetX:number(-2,2), lyricOffsetY:number(-1.2,1.35), lyricOffsetZ:number(-1.6,1.6),
      lyricTiltX:number(-42,42), lyricTiltY:number(-42,42), lyricCameraLock:bool(),
      lyricColorMode:enumeration(['auto','custom']), lyricColor:color(), lyricHighlightMode:enumeration(['auto','custom']), lyricHighlightColor:color(),
      lyricGlowLinked:bool(), lyricGlowColor:color(), lyricFont:string(80), lyricLetterSpacing:number(-.04,.18), lyricLineHeight:number(.86,1.35), lyricWeight:number(500,900,true),
      desktopLyrics:bool(), desktopLyricsSize:number(.72,1.55), desktopLyricsOpacity:number(.28,1), desktopLyricsY:number(.08,.92),
      desktopLyricsClickThrough:bool(), desktopLyricsCinema:bool(), desktopLyricsHighlight:bool(), desktopLyricsFps:enumeration([30,60], { '30fps':30, '60fps':60 })
    },
    spectrum: {
      enabled:bool(), mode:enumeration([1,3], { one:1, three:3, shape1:1, shape3:3, bars:1, edge:3 }), bandCount:number(1,256,true), horizontalGap:number(0,32), heightScale:number(.25,3),
      opacity:number(.08,1), brightness:number(.1,2.5), glow:number(0,2.5), colorMode:enumeration(['single','multi','gradient','cover']), colorA:color(), colorB:color(),
      liquidGlassEnabled:bool(), attack:number(.01,1), release:number(.005,.8), offset:number(-1.5,1.5), symmetry:bool(), smooth:number(0,.96), sensitivity:number(.2,3)
    },
    echo: {
      enabled:bool(), shape:enumeration(['shape1','shape2'], {
        one:'shape1', two:'shape2', three:'shape1', four:'shape1',
        shape3:'shape1', shape4:'shape1', terrain:'shape1', classic:'shape1',
        exposure:'shape2', topology:'shape2', dark:'shape1', preview:'shape1', wide:'shape1', impact:'shape1'
      }), audioMonitor:bool(),
      quality:enumeration(['auto','low','medium','high'], { eco:'low', balanced:'medium', ultra:'high' }),
      particleStrength:number(0,2), mode1LeftLyricsEnabled:bool(),
      theme:enumeration(['neonPurple','azure','ice','emerald','gold','ink','deepCyan','lavender','sakura','copper','mint','ember','flame','hazePink','fantasy']),
      flip:bool(), showColorOptions:bool(), renderResolution:number(.35,1.5), autoCycle:bool(), cycleInterval:number(3,300), accentEnabled:bool(), accentColor:color(), accentStrength:number(0,2),
      responseStrength:number(0,3), responseRange:number(.08,1), visualEq:numberArray(8,0,2), rippleEnabled:bool(), rippleSensitivity:number(0,1), rippleCooldown:number(1,240),
      idleWave:bool(), idleDebounce:number(0,20), idleFade:number(.1,12),
      cameraDistance:number(.45,2.8), cameraHorizontal:number(-180,180), cameraElevation:number(5,78), autoRotate:bool(), rotateSpeed:number(-2,2),
      exposureSize:number(.5,14), exposureStrength:number(0,2), exposureRadius:number(.1,1.5), trailLength:number(0,1), trailDecay:number(.01,.8), flashThreshold:number(.05,1.5),
      flashEnabled:bool(), reducedFlash:bool()
    },
    camera: {
      cam:enumeration(['off','gesture']),
      mode:enumeration(['off','gesture','freeOrbit','freeOrbitDrag','fixed'], {
        free:'freeOrbit', orbit:'freeOrbit', drag:'freeOrbitDrag', freeorbit:'freeOrbit', freeorbitdrag:'freeOrbitDrag'
      }),
      mouseYaw:strictNumber(-360,360), mousePitch:strictNumber(-360,360), smoothing:strictNumber(0,1),
      freeOrbit:bool(), unrestrictedPitch:bool(), pitchLimit:numberOr(['none'], -360, 360),
      yawLimit:numberOr(['none'], -360, 360),
      allowVerticalFlip:bool(), allowFull360Rotation:bool(), allowRoll:bool(), allowPan:bool(),
      mouseFollowRotation:bool(), leftDragOrbit:bool(), leftDragPan:bool(), rightDragPan:bool(), middleDragRoll:bool(), wheelZoom:bool(),
      resetKeepsFreeControls:bool(), hoverRotate:bool(), rotateOnlyWhileLeftDrag:bool(),
      fixedPosition:numberArray(3,-100000,100000), fixedTarget:numberArray(3,-100000,100000),
      defaultPosition:numberArray(3,-100000,100000), defaultTarget:numberArray(3,-100000,100000), defaultRotation:numberArray(3,-360,360),
      fieldOfView:strictNumber(1,179), doubleLeftClickReset:bool(), resetDurationMs:strictNumber(0,10000,true),
      dynamicNearFar:bool(), orbitTarget:numberArray(3,-100000,100000), zoomTarget:numberArray(3,-100000,100000),
      zoomAroundTarget:bool(), keepTargetCenteredDuringZoom:bool(), zoomAlongViewRay:bool(),
      defaultTopDownBias:bool(), preserveFreeOrbit:bool()
    },
    glass: {
      opacity:number(.08,.72), blur:number(8,42), chroma:number(0,1), highlight:number(0,1.4), radius:number(10,36), elastic:number(0,1), controlChromaticOffset:number(0,140)
    },
    player: { visible:bool(), cover:bool(), size:number(.55,1.8), x:number(-45,45), y:number(-34,34), preservePlayback:bool() }
  };

  var RETIRED_CUSTOM_MODES = {};
  RETIRED_CUSTOM_MODES[['luminous','OrbitVortex'].join('')] = '问题14已废弃白色正圆光环/超大半径星轨旧实现';
  RETIRED_CUSTOM_MODES[['tsunami','Curl'].join('')] = '问题14已废弃 GPT 海啸粒子旧实现';
  RETIRED_CUSTOM_MODES[['gold','enStarTrailOrbitField'].join('')] = 'v1.1.44 已移除该自定义粒子预设';
  Object.freeze(RETIRED_CUSTOM_MODES);
  var RETIRED_PRESET_NAMES = Object.freeze([
    'GPT海啸粒子预设1',
    'GPT粒子预设_白色正圆超大半径自由星轨粒子',
    'GPT粒子预设_正圆光环白色粒子',
    ['金色量子核心·中心结构特写','自由星轨粒子（中心球圆心缩放修正版）'].join(''),
    ['金色量子','自由星轨'].join(''),
    ['LF金色量子','自由星轨粒子'].join(''),
    ['lf-gold','en-atomic-star-trail-free-orbit-v5.3.1'].join('')
  ]);
  var BUILTIN_PRESETS = Object.freeze({
    emily:Object.freeze({ index:0, name:'emily专辑封面' }),
    roller:Object.freeze({ index:1, name:'滚筒' }),
    planet:Object.freeze({ index:2, name:'星球' }),
    void:Object.freeze({ index:3, name:'虚空' }),
    record:Object.freeze({ index:4, name:'唱片' }),
    galaxy:Object.freeze({ index:5, name:'星河' }),
    requiem:Object.freeze({ index:6, name:'安魂' })
  });
  var MODE_DEFINITIONS = {};
  var KEY_ALIASES = {
    visual: {
      visualpreset:'preset', presetindex:'preset', strength:'intensity', shake:'cinemaShake', camerashake:'cinemaShake', coverquality:'coverResolution', resolution:'coverResolution',
      tintmode:'visualTintMode', tintcolor:'visualTintColor', accentcolor:'uiAccentColor',
      backgroundcolorcustom:{ key:'backgroundColorMode', transform:function (value) { return booleanValue(value) ? 'custom' : 'cover'; } }
    },
    particles: {
      particlesize:'point', size:'point', motionspeed:'speed', turbulence:'twist', colorstrength:'color', dispersion:'scatter', backgroundfade:'bgFade', bloomintensity:'bloomStrength'
    },
    lyrics: {
      translation:'translate', showtranslation:'translate', fontsize:'lyricScale', size:'lyricScale', textcolor:'lyricColor',
      highlightcolor:'lyricHighlightColor', fontfamily:'lyricFont', letterspacing:'lyricLetterSpacing', lineheight:'lyricLineHeight', fontweight:'lyricWeight'
    },
    spectrum: {
      shape:'mode', visualmode:'mode', bars:'bandCount', barcount:'bandCount', bands:'bandCount', frequencybands:'bandCount', gap:'horizontalGap', bargap:'horizontalGap',
      amplitude:'heightScale', maxheight:'heightScale', alpha:'opacity', luminance:'brightness', glowstrength:'glow', palettemode:'colorMode', color1:'colorA', startcolor:'colorA',
      color2:'colorB', endcolor:'colorB', glass:'liquidGlassEnabled', liquidglass:'liquidGlassEnabled', smoothing:'smooth', gain:'sensitivity', symmetric:'symmetry', mirror:'symmetry',
      yoffset:{ key:'offset', transform:function (value) { return Number(value) / 220; } }, offsety:{ key:'offset', transform:function (value) { return Number(value) / 220; } }
    },
    echo: {
      mode:'shape', precision:'renderResolution', resolution:'renderResolution', renderquality:'quality', densityquality:'quality', visualeq:'visualEq', eq:'visualEq', accent:'accentColor',
      strength:'responseStrength', range:'responseRange'
    },
    camera: { cameramode:'mode' },
    glass: {
      panelopacity:'opacity', blurradius:'blur', chromatic:'chroma', chromaticaberration:'chroma', highlightstrength:'highlight', borderradius:'radius', elasticity:'elastic', chromaticoffset:'controlChromaticOffset'
    },
    player: { show:'visible', shown:'visible', showcover:'cover', covershown:'cover', scale:'size', offsetx:'x', offsety:'y' }
  };
  KEY_ALIASES.particles[['ai','depth'].join('')] = { key:'depthDistribution', transform:function (value) { return booleanValue(value); } };
  var REDIRECTS = {
    echo: {
      playervisible:['player','visible'], playercover:['player','cover'], playersize:['player','size'], playerx:['player','x'], playery:['player','y']
    },
    visual: { controlglasschromaticoffset:['glass','controlChromaticOffset'] }
  };
  var ROOT_ALIASES = {
    playervisible:['player','visible'], playercover:['player','cover'], playersize:['player','size'], playerx:['player','x'], playery:['player','y'],
    controlglasschromaticoffset:['glass','controlChromaticOffset']
  };
  var REMOVED = {
    fandepth:1, fanradius:1, fanangle:1, fanperspective:1, fanrotation:1, fanmode:1,
    dynamiclyrics:1, lyricspace:1, lyricscenter:1, lyricsradius:1, lyricsdepth:1, lyricsspread:1
  };
  var WALLPAPER = {
    wallpaper:1, wallpaperopacity:1, wallpapermode:1, backgroundmedia:1, backgroundimage:1
  };

  function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function token(value) { return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ''); }
  function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function fileBase(value) {
    return String(value || '').split(/[\\/]/).pop().replace(/\.json$/i, '').trim().slice(0, 64);
  }
  function safeName(value, fallback) {
    value = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    return (value || fallback || '导入预设').slice(0, 64);
  }
  function retiredPresetIdentity(value) {
    if (!plain(value)) return '';
    var candidates = [value.name,value.title,value.presetName,value.presetId,value.id].filter(function (entry) { return entry != null; });
    for (var index = 0; index < candidates.length; index++) {
      var candidate = token(fileBase(candidates[index]));
      for (var retiredIndex = 0; retiredIndex < RETIRED_PRESET_NAMES.length; retiredIndex++) {
        if (candidate === token(RETIRED_PRESET_NAMES[retiredIndex])) return RETIRED_PRESET_NAMES[retiredIndex];
      }
    }
    return '';
  }
  function colorValue(value) {
    var text = String(value == null ? '' : value).trim();
    var short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
    if (short) return '#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3];
    if (/^#[0-9a-f]{6}$/i.test(text)) return text;
    var rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(text);
    if (rgb) {
      var parts = [rgb[1],rgb[2],rgb[3]].map(function (part) { return Math.max(0, Math.min(255, Number(part))); });
      return '#' + parts.map(function (part) { return Math.round(part).toString(16).padStart(2, '0'); }).join('');
    }
    throw new Error('颜色无效');
  }
  function booleanValue(value) {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === 0) return value === 1;
    var text = token(value);
    if (/^(true|yes|on|enabled|enable|open|1|开启|启用)$/.test(text)) return true;
    if (/^(false|no|off|disabled|disable|close|0|关闭|停用)$/.test(text)) return false;
    throw new Error('布尔值无效');
  }
  function enumValue(value, spec) {
    for (var exactIndex = 0; exactIndex < spec.values.length; exactIndex++) {
      if (value === spec.values[exactIndex]) return spec.values[exactIndex];
    }
    var valueToken = token(value);
    var aliasKeys = Object.keys(spec.aliases || {});
    for (var a = 0; a < aliasKeys.length; a++) if (token(aliasKeys[a]) === valueToken) return spec.aliases[aliasKeys[a]];
    if (typeof value === 'number') throw new Error('枚举值无效');
    for (var i = 0; i < spec.values.length; i++) {
      if (typeof spec.values[i] !== 'number' && token(spec.values[i]) === valueToken) return spec.values[i];
    }
    throw new Error('枚举值无效');
  }
  function normalizeValue(value, spec, path) {
    path = path || '$';
    if (spec.type === 'number') {
      if (value == null || (spec.strict && typeof value !== 'number')) throw new Error('数值类型无效');
      var numeric = Number(value);
      if (!isFinite(numeric)) throw new Error('数值无效');
      if (spec.strict && (numeric < spec.min || numeric > spec.max || (spec.integer && Math.floor(numeric) !== numeric))) throw new Error('数值超出范围');
      numeric = Math.max(spec.min, Math.min(spec.max, numeric));
      return spec.integer ? Math.round(numeric) : numeric;
    }
    if (spec.type === 'boolean') {
      if (spec.strict && typeof value !== 'boolean') throw new Error('布尔类型无效');
      return booleanValue(value);
    }
    if (spec.type === 'color') return colorValue(value);
    if (spec.type === 'enum') return enumValue(value, spec);
    if (spec.type === 'string') {
      if (value == null || typeof value === 'object') throw new Error('字符串类型无效');
      return String(value).slice(0, spec.max);
    }
    if (spec.type === 'numberArray') {
      if (!Array.isArray(value) || value.length !== spec.length) throw new Error('必须包含 ' + spec.length + ' 个数值');
      return value.map(function (entry) {
        if (entry == null || typeof entry !== 'number') throw new Error('数组数值类型无效');
        var numeric = Number(entry);
        if (!isFinite(numeric) || numeric < spec.min || numeric > spec.max) throw new Error('数组数值超出范围');
        return numeric;
      });
    }
    if (spec.type === 'array') {
      if (!Array.isArray(value)) throw new Error('数组类型无效');
      if (spec.length != null && value.length !== spec.length) throw new Error('数组长度必须为 ' + spec.length);
      if (spec.minLength != null && value.length < spec.minLength) throw new Error('数组长度不足');
      if (spec.maxLength != null && value.length > spec.maxLength) throw new Error('数组长度超限');
      return value.map(function (entry, index) { return normalizeValue(entry, spec.item, path + '[' + index + ']'); });
    }
    if (spec.type === 'tuple') {
      if (!Array.isArray(value) || value.length !== spec.items.length) throw new Error('元组长度必须为 ' + spec.items.length);
      return spec.items.map(function (entrySpec, index) { return normalizeValue(value[index], entrySpec, path + '[' + index + ']'); });
    }
    if (spec.type === 'object') {
      if (!plain(value)) throw new Error('对象类型无效');
      var normalizedObject = {};
      spec.required.forEach(function (key) { if (!own(value,key)) throw new Error('缺少必需字段 ' + key); });
      Object.keys(value).forEach(function (key) {
        if (DANGEROUS[key]) throw new Error('不安全字段名');
        if (!own(spec.fields,key)) throw new Error('对象包含未知字段 ' + key);
        normalizedObject[key] = normalizeValue(value[key], spec.fields[key], path + '.' + key);
      });
      return normalizedObject;
    }
    if (spec.type === 'numberOr') {
      if (typeof value === 'number') {
        if (!isFinite(value) || value < spec.min || value > spec.max) throw new Error('数值超出范围');
        return value;
      }
      var normalizedToken = token(value);
      for (var allowedIndex = 0; allowedIndex < spec.values.length; allowedIndex++) {
        if (token(spec.values[allowedIndex]) === normalizedToken) return spec.values[allowedIndex];
      }
      throw new Error('混合类型值无效');
    }
    throw new Error('字段类型无效');
  }

  function consumerForPath(path) {
    if (path.indexOf('camera.') === 0) return 'cameraController';
    if (path.indexOf('spectrum.') === 0) return 'SpectrumState';
    if (path.indexOf('echo.') === 0) return 'AudioEchoState';
    if (path.indexOf('lyrics.') === 0) return 'LyricsState';
    if (path.indexOf('player.') === 0) return 'PlayerState';
    if (path.indexOf('visual.') === 0 || path.indexOf('particles.') === 0) return 'ParticleVisualState';
    return 'PresetMetadata';
  }
  function consumptionStatusForPath(path) {
    return /^(?:visual|particles|camera)\./.test(path) ? 'IMPLEMENTED_AND_RENDERED' : 'IMPLEMENTED_STATE_ONLY';
  }
  function normalizeParticleCustom(value, path) {
    var ignored = [];
    leafUnknown(value, path, ignored, 'v1.1.44 已移除自定义粒子预设', 0);
    return {
      custom:null,
      mode:'',
      appliedFields:[],
      ignoredFields:ignored,
      invalidFields:[{
        sourcePath:path,
        canonicalPath:'',
        value:copy(value),
        reason:'v1.1.44 已移除自定义粒子预设；请选择七个内置预设之一',
        code:'CUSTOM_PARTICLE_PRESET_REMOVED',
        critical:true
      }],
      migrations:[],
      migrationRecords:[]
    };
  }
  var KEY_TOKENS = {};
  var ROOT_INDEX = {};
  Object.keys(SPECS).forEach(function (namespace) {
    KEY_TOKENS[namespace] = {};
    Object.keys(SPECS[namespace]).forEach(function (key) {
      var keyToken = token(key);
      KEY_TOKENS[namespace][keyToken] = key;
      if (!ROOT_INDEX[keyToken]) ROOT_INDEX[keyToken] = [];
      ROOT_INDEX[keyToken].push([namespace,key]);
    });
  });

  function leafUnknown(value, path, ignored, reason, depth) {
    if (depth > 8) { ignored.push({ sourcePath:path, value:copy(value), reason:'字段嵌套过深' }); return; }
    if (plain(value)) {
      var keys = Object.keys(value).sort();
      if (!keys.length) ignored.push({ sourcePath:path, value:{}, reason:reason || '未识别字段' });
      keys.forEach(function (key) {
        leafUnknown(value[key], path + '.' + key, ignored, DANGEROUS[key] ? '不安全字段名' : reason, depth + 1);
      });
      return;
    }
    ignored.push({ sourcePath:path, value:copy(value), reason:reason || '未识别字段' });
  }

  function normalize(payload, options) {
    options = options || {};
    if (!plain(payload)) throw new Error('根节点必须是对象');
    var typeToken = token(payload.type);
    var schemaToken = token(payload.schema);
    var canonicalInput = typeToken === token(TYPE) || schemaToken === token(SCHEMA);
    if (canonicalInput && payload.type != null && typeToken !== token(TYPE)) throw new Error('CanonicalPresetSchema type 不匹配');
    if (canonicalInput && payload.schema != null && schemaToken !== token(SCHEMA)) throw new Error('CanonicalPresetSchema schema 不匹配');
    var sourceVersion = Number(payload.version != null ? payload.version : payload.schemaVersion);
    if (!isFinite(sourceVersion)) sourceVersion = 1;
    if (canonicalInput) {
      if (sourceVersion < 0 || sourceVersion > VERSION) throw new Error('不支持的 CanonicalPresetSchema 版本');
    } else if ((typeToken === 'lumifielduserfxarchive' || typeToken === 'lumifieldechopreset') && payload.schema != null) {
      var oldSchema = Number(payload.schema);
      if (!isFinite(oldSchema) || oldSchema < 1 || oldSchema > 2) throw new Error('不支持的旧版预设版本');
    }

    var candidates = {};
    var customCandidates = [];
    var ignored = [];
    var invalid = [];
    var migrationRecords = [];
    var migrations = [];
    var compatibilityConsumptions = [];
    var retiredIdentity = retiredPresetIdentity(payload);
    if (retiredIdentity) {
      invalid.push({
        sourcePath:payload.name != null ? 'name' : (payload.title != null ? 'title' : 'presetId'),
        canonicalPath:'', value:retiredIdentity,
        reason:'问题14已明确废弃该 GPT 粒子预设', code:'RETIRED_PRESET', critical:true
      });
    }
    if (!canonicalInput || sourceVersion !== VERSION) {
      var initialMigration = {
        sourceVersion:sourceVersion, targetVersion:VERSION, oldPath:'$', newPath:'$',
        valueTransform:'canonical-normalization', warning:canonicalInput ? '旧 CanonicalPresetSchema 已迁移' : '旧格式已迁移到 CanonicalPresetSchema',
        reversible:true
      };
      migrationRecords.push(initialMigration);
      migrations.push(initialMigration.warning + ' v' + VERSION);
    }
    var wallpaper = null;
    var leafCount = 0;
    function ignore(path, reason, value) { ignored.push({ sourcePath:path, value:copy(value), reason:reason }); }
    function candidate(namespace, key, value, sourcePath, priority, alias, transform) {
      var target = namespace + '.' + key;
      if (!candidates[target]) candidates[target] = [];
      candidates[target].push({ namespace:namespace, key:key, value:value, sourcePath:sourcePath, priority:priority, alias:!!alias, transform:transform });
    }
    function wallpaperField(key, value, path) {
      wallpaper = wallpaper || {};
      var keyToken = token(key);
      if (keyToken === 'wallpaperopacity' || keyToken === 'backgroundopacity' || keyToken === 'opacity') {
        var opacity = Number(value);
        if (isFinite(opacity)) wallpaper.opacity = Math.max(0, Math.min(1, opacity));
      } else if (keyToken === 'backgroundmedia' || keyToken === 'media') wallpaper.media = copy(value);
      else if (keyToken === 'backgroundimage' || keyToken === 'image') wallpaper.media = { type:'image', src:String(value || '') };
      ignore(path, '壁纸/本机字段默认不导入');
    }
    function processWallpaper(value, path) {
      if (!plain(value)) { wallpaperField('wallpaper', value, path); return; }
      Object.keys(value).sort().forEach(function (key) { wallpaperField(key, value[key], path + '.' + key); });
    }
    function lookupAlias(namespace, keyToken) {
      var alias = KEY_ALIASES[namespace] && KEY_ALIASES[namespace][keyToken];
      if (!alias) return null;
      return typeof alias === 'string' ? { key:alias } : alias;
    }
    function processNamespace(value, path, namespace, basePriority, exactNamespace, legacyLoose) {
      if (!plain(value)) { ignore(path, '命名空间必须是对象'); return; }
      Object.keys(value).sort().forEach(function (key) {
        leafCount++;
        var sourcePath = path + '.' + key;
        if (leafCount > 4096) { ignore(sourcePath, '字段数量超过限制'); return; }
        if (DANGEROUS[key]) { leafUnknown(value[key], sourcePath, ignored, '不安全字段名', 0); return; }
        var keyToken = token(key);
        if (namespace === 'lyrics' && keyToken === 'mode') {
          var retiredLyricMode = token(value[key]);
          if (retiredLyricMode === 'off' || retiredLyricMode === 'none' || retiredLyricMode === 'disabled') {
            compatibilityConsumptions.push({
              sourcePath:sourcePath, canonicalPath:'', value:copy(value[key]), alias:true, mode:'',
              consumer:'PresetMigration', consumptionStatus:'MIGRATED_REMOVED',
              reason:'旧歌词模式字段已移除；导入预设不得改变歌词可见状态'
            });
            var lyricMigration = {
              sourceVersion:sourceVersion, targetVersion:VERSION, oldPath:sourcePath, newPath:'$removed.lyrics.mode',
              valueTransform:'removed-no-op-preserve-lyrics', warning:'旧歌词模式字段已安全移除且不改变歌词状态', reversible:false
            };
            migrationRecords.push(lyricMigration);
            migrations.push(lyricMigration.oldPath + ' → ' + lyricMigration.newPath);
          } else {
            invalid.push({
              sourcePath:sourcePath, canonicalPath:'', value:copy(value[key]),
              reason:'旧歌词模式字段只允许迁移关闭值', code:'RETIRED_LYRIC_MODE_INVALID', critical:true
            });
          }
          return;
        }
        if (REMOVED[keyToken]) { leafUnknown(value[key], sourcePath, ignored, '旧版字段已停用', 0); return; }
        if (namespace === 'particles' && keyToken === 'custom') {
          customCandidates.push({
            value:value[key], sourcePath:sourcePath,
            priority:basePriority + (exactNamespace && key === 'custom' ? 60 : 20)
          });
          return;
        }
        var exactKey = KEY_TOKENS[namespace][keyToken];
        if (exactKey) { candidate(namespace, exactKey, value[key], sourcePath, basePriority + (exactNamespace ? 40 : 20), false); return; }
        var alias = lookupAlias(namespace, keyToken);
        if (alias) { candidate(namespace, alias.key, value[key], sourcePath, basePriority, true, alias.transform); return; }
        var redirect = REDIRECTS[namespace] && REDIRECTS[namespace][keyToken];
        if (redirect) { candidate(redirect[0], redirect[1], value[key], sourcePath, basePriority - 5, true); return; }
        if (legacyLoose && ROOT_INDEX[keyToken] && ROOT_INDEX[keyToken].length === 1) {
          var loose = ROOT_INDEX[keyToken][0]; candidate(loose[0], loose[1], value[key], sourcePath, basePriority - 20, true); return;
        }
        leafUnknown(value[key], sourcePath, ignored, '未识别字段', 0);
      });
    }
    function processContainer(value, path, basePriority, depth) {
      if (!plain(value)) { ignore(path || '$', '容器必须是对象'); return; }
      if (depth > 4) { leafUnknown(value, path || '$', ignored, '字段嵌套过深', 0); return; }
      Object.keys(value).sort().forEach(function (key) {
        leafCount++;
        var sourcePath = path ? path + '.' + key : key;
        if (leafCount > 4096) { ignore(sourcePath, '字段数量超过限制'); return; }
        if (DANGEROUS[key]) { leafUnknown(value[key], sourcePath, ignored, '不安全字段名', 0); return; }
        var keyToken = token(key);
        if (META[keyToken]) return;
        if (REMOVED[keyToken]) { leafUnknown(value[key], sourcePath, ignored, '旧版字段已停用', 0); return; }
        if (WALLPAPER[keyToken]) {
          if (keyToken === 'wallpaper') processWallpaper(value[key], sourcePath); else wallpaperField(key, value[key], sourcePath);
          return;
        }
        if (WRAPPERS[keyToken] && plain(value[key])) {
          if (keyToken === 'settings' || keyToken === 'configuration' || keyToken === 'config') migrations.push(sourcePath + ' 包装层已展开');
          processContainer(value[key], sourcePath, basePriority - 40, depth + 1); return;
        }
        if (!canonicalInput && keyToken === 'backgroundopacity') {
          wallpaperField(key, value[key], sourcePath); return;
        }
        var namespace = NAMESPACE_ALIASES[keyToken];
        if (namespace && plain(value[key])) {
          processNamespace(value[key], sourcePath, namespace, basePriority + 120, keyToken === namespace, !canonicalInput); return;
        }
        var rootAlias = ROOT_ALIASES[keyToken];
        if (rootAlias) { candidate(rootAlias[0], rootAlias[1], value[key], sourcePath, basePriority, true); return; }
        var indexed = ROOT_INDEX[keyToken];
        if (indexed && indexed.length === 1) { candidate(indexed[0][0], indexed[0][1], value[key], sourcePath, basePriority + 10, true); return; }
        leafUnknown(value[key], sourcePath, ignored, indexed ? '字段命名空间不明确' : '未识别字段', 0);
      });
    }

    if (typeToken === 'lumifieldechopreset' && plain(payload.state)) {
      processNamespace(payload.state, 'state', 'echo', 260, false, true);
      var echoRoot = {};
      Object.keys(payload).forEach(function (key) { if (token(key) !== 'state') echoRoot[key] = payload[key]; });
      processContainer(echoRoot, '', 300, 0);
    } else processContainer(payload, '', canonicalInput ? 500 : 300, 0);

    var canonical = { type:TYPE, schema:SCHEMA, version:VERSION };
    var metadataFields = [
      { sourcePath:'type', canonicalPath:'type', value:TYPE, consumer:'PresetMetadata', consumptionStatus:'METADATA_ONLY' },
      { sourcePath:'schema', canonicalPath:'schema', value:SCHEMA, consumer:'PresetMetadata', consumptionStatus:'METADATA_ONLY' },
      { sourcePath:payload.version != null ? 'version' : 'schemaVersion', canonicalPath:'version', value:VERSION, consumer:'PresetMetadata', consumptionStatus:sourceVersion === VERSION ? 'METADATA_ONLY' : 'MIGRATED' }
    ];
    function metadata(key, value, max) {
      if (value == null) return;
      var normalized = String(value).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 128);
      if (!normalized) return;
      canonical[key] = normalized;
      metadataFields.push({
        sourcePath:key, canonicalPath:key, value:normalized, consumer:'PresetMetadata',
        consumptionStatus:'METADATA_ONLY'
      });
    }
    var sourceName = payload.name != null ? payload.name : (payload.title != null ? payload.title : payload.presetName);
    canonical.name = safeName(sourceName, fileBase(options.fileName));
    metadataFields.push({ sourcePath:payload.name != null ? 'name' : (payload.title != null ? 'title' : 'fileName'), canonicalPath:'name', value:canonical.name, consumer:'PresetMetadata', consumptionStatus:'METADATA_ONLY' });
    var sourceId = payload.presetId != null ? payload.presetId : payload.id;
    if (sourceId != null && /^[a-z0-9][a-z0-9._:-]{5,127}$/i.test(String(sourceId))) {
      canonical.presetId = String(sourceId);
      metadataFields.push({ sourcePath:payload.presetId != null ? 'presetId' : 'id', canonicalPath:'presetId', value:canonical.presetId, consumer:'PresetMetadata', consumptionStatus:'METADATA_ONLY' });
    }
    metadata('title', payload.title, 160);
    metadata('appVersion', payload.appVersion, 40);
    metadata('visualPresetSchema', payload.visualPresetSchema, 80);
    var createdRaw = payload.createdAt != null ? payload.createdAt : (payload.savedAt != null ? payload.savedAt : 0);
    var createdAt = Number(createdRaw);
    if (isFinite(createdAt) && createdAt > 0) {
      canonical.createdAt = Math.floor(createdAt);
      metadataFields.push({ sourcePath:payload.createdAt != null ? 'createdAt' : 'savedAt', canonicalPath:'createdAt', value:canonical.createdAt, consumer:'PresetMetadata', consumptionStatus:payload.createdAt != null ? 'METADATA_ONLY' : 'MIGRATED' });
    }

    var applied = compatibilityConsumptions.slice();
    Object.keys(candidates).sort().forEach(function (target) {
      var list = candidates[target].sort(function (left, right) {
        return right.priority - left.priority || left.sourcePath.localeCompare(right.sourcePath);
      });
      var winner = null;
      for (var i = 0; i < list.length; i++) {
        var entry = list[i];
        try {
          var raw = entry.transform ? entry.transform(entry.value) : entry.value;
          entry.normalized = normalizeValue(raw, SPECS[entry.namespace][entry.key], target);
          winner = entry;
          break;
        } catch (error) {
          entry.invalid = true;
          invalid.push({
            sourcePath:entry.sourcePath, canonicalPath:target, value:copy(entry.value),
            reason:'字段值无效：' + error.message, code:'FIELD_INVALID',
            critical:entry.namespace === 'camera'
          });
        }
      }
      if (!winner) return;
      if (!canonical[winner.namespace]) canonical[winner.namespace] = {};
      canonical[winner.namespace][winner.key] = winner.normalized;
      applied.push({
        sourcePath:winner.sourcePath, canonicalPath:target, value:copy(winner.normalized), alias:winner.alias,
        mode:'', consumer:consumerForPath(target,''), consumptionStatus:winner.alias ? 'MIGRATED' : consumptionStatusForPath(target)
      });
      list.forEach(function (entry) {
        if (entry !== winner && !entry.invalid) ignore(entry.sourcePath, '被更高优先级字段 ' + winner.sourcePath + ' 覆盖');
      });
      if (winner.alias) {
        var record = {
          sourceVersion:sourceVersion, targetVersion:VERSION, oldPath:winner.sourcePath, newPath:target,
          valueTransform:winner.transform ? 'registered-transform' : 'identity', warning:'旧字段别名已迁移', reversible:!winner.transform
        };
        migrationRecords.push(record);
        migrations.push(record.oldPath + ' → ' + record.newPath);
      }
    });

    var mode = '';
    if (customCandidates.length) {
      customCandidates.sort(function (left,right) { return right.priority - left.priority || left.sourcePath.localeCompare(right.sourcePath); });
      var removedCustom = normalizeParticleCustom(customCandidates[0].value, customCandidates[0].sourcePath);
      ignored = ignored.concat(removedCustom.ignoredFields);
      invalid = invalid.concat(removedCustom.invalidFields);
      customCandidates.slice(1).forEach(function (entry) {
        leafUnknown(entry.value, entry.sourcePath, ignored, '重复的已移除自定义粒子字段', 0);
      });
    }

    ignored.sort(function (a, b) { return a.sourcePath.localeCompare(b.sourcePath) || a.reason.localeCompare(b.reason); });
    applied.sort(function (a, b) { return a.canonicalPath.localeCompare(b.canonicalPath); });
    invalid.sort(function (a,b) { return a.sourcePath.localeCompare(b.sourcePath) || a.reason.localeCompare(b.reason); });
    migrations = migrations.filter(function (value, index, list) { return list.indexOf(value) === index; });
    migrationRecords = migrationRecords.filter(function (record,index,list) {
      return list.findIndex(function (entry) { return entry.oldPath === record.oldPath && entry.newPath === record.newPath; }) === index;
    });
    if (!applied.length && !wallpaper && !invalid.length && options.allowEmpty !== true) throw new Error('未找到可导入的视觉字段');
    var fieldMatrix = metadataFields.concat(applied).concat(ignored.map(function (field) {
      return {
        sourcePath:field.sourcePath, canonicalPath:'', value:copy(field.value), consumer:'',
        consumptionStatus:'UNSUPPORTED_WITH_REASON', reason:field.reason
      };
    })).concat(invalid.map(function (field) {
      return {
        sourcePath:field.sourcePath, canonicalPath:field.canonicalPath || '', value:copy(field.value), consumer:'',
        consumptionStatus:'INVALID_WITH_REASON', reason:field.reason, code:field.code
      };
    }));
    var report = {
      canonical:canonical,
      appliedFields:applied,
      consumedFields:applied.slice(),
      metadataFields:metadataFields,
      ignoredFields:ignored,
      invalidFields:invalid,
      rejectedFields:invalid.slice(),
      unsupportedFields:ignored.map(function (item) { return { sourcePath:item.sourcePath, value:copy(item.value), reason:item.reason }; }),
      unknownFields:ignored.filter(function (item) { return item.reason === '未识别字段'; }).map(function (item) { return item.sourcePath; }),
      migrations:migrations,
      migrationRecords:migrationRecords,
      fieldMatrix:fieldMatrix,
      mode:mode,
      effectSchemaVersion:mode ? EFFECT_SCHEMA_VERSION : null,
      wallpaper:wallpaper,
      source:{ canonical:canonicalInput, version:sourceVersion, targetVersion:VERSION },
      statistics:{
        metadataFields:metadataFields.length,
        consumedFields:applied.length,
        migratedFields:migrationRecords.length,
        ignoredFields:ignored.length,
        rejectedFields:invalid.length
      }
    };
    if (invalid.some(function (item) { return item.critical; }) && options.collectErrors !== true) {
      var critical = new Error('粒子预设关键字段验证失败：' + invalid.filter(function (item) { return item.critical; }).map(function (item) { return item.sourcePath; }).join('、'));
      critical.code = 'PRESET_SCHEMA_INVALID';
      critical.report = report;
      throw critical;
    }
    return report;
  }

  function parse(text, options) {
    text = String(text == null ? '' : text);
    if (text.length > 20 * 1024 * 1024) throw new Error('JSON 文件超过 20 MB');
    var payload;
    try { payload = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (_) { throw new Error('JSON 解析失败'); }
    return normalize(payload, options);
  }

  function orderedCanonical(value) {
    var result = normalize(value, { allowEmpty:true }).canonical;
    var ordered = { type:TYPE, schema:SCHEMA, version:VERSION };
    ['presetId','name','title','appVersion','visualPresetSchema','createdAt'].forEach(function (key) { if (own(result,key)) ordered[key] = result[key]; });
    Object.keys(SPECS).forEach(function (namespace) {
      if (!result[namespace]) return;
      ordered[namespace] = {};
      Object.keys(SPECS[namespace]).forEach(function (key) { if (own(result[namespace],key)) ordered[namespace][key] = copy(result[namespace][key]); });
      if (!Object.keys(ordered[namespace]).length) delete ordered[namespace];
    });
    return ordered;
  }
  function serialize(value, space) { return JSON.stringify(orderedCanonical(value), null, space == null ? 2 : space); }
  function looksPrivatePath(value) {
    value = String(value || '');
    return /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value) || /^(?:file|blob|data):/i.test(value) || /^\/(?:users|home|var|private|mnt)\//i.test(value);
  }
  function sanitizeForShare(value) {
    var canonical = orderedCanonical(value);
    var removed = [];
    if (canonical.presetId) { removed.push({ canonicalPath:'presetId', reason:'本地标识不分享' }); delete canonical.presetId; }
    if (canonical.createdAt) { removed.push({ canonicalPath:'createdAt', reason:'本地时间不分享' }); delete canonical.createdAt; }
    if (looksPrivatePath(canonical.name)) canonical.name = '共享预设';
    function scrub(object, path) {
      if (!plain(object)) return;
      Object.keys(object).forEach(function (key) {
        var childPath = path ? path + '.' + key : key;
        var child = object[key];
        if (typeof child === 'string' && looksPrivatePath(child)) {
          removed.push({ canonicalPath:childPath, reason:'本地路径不分享' });
          delete object[key];
        } else if (plain(child)) scrub(child, childPath);
      });
    }
    scrub(canonical, '');
    return { canonical:canonical, removedFields:removed };
  }

  function deepEqual(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
      for (var index = 0; index < left.length; index++) if (!deepEqual(left[index],right[index])) return false;
      return true;
    }
    if (plain(left) || plain(right)) {
      if (!plain(left) || !plain(right)) return false;
      var leftKeys = Object.keys(left).sort();
      var rightKeys = Object.keys(right).sort();
      if (leftKeys.length !== rightKeys.length) return false;
      for (var keyIndex = 0; keyIndex < leftKeys.length; keyIndex++) {
        if (leftKeys[keyIndex] !== rightKeys[keyIndex] || !deepEqual(left[leftKeys[keyIndex]],right[rightKeys[keyIndex]])) return false;
      }
      return true;
    }
    return false;
  }

  function diffCategory(path) {
    if (/^(?:type|schema|version|presetId|name|title|appVersion|visualPresetSchema|createdAt)$/.test(path)) return 'metadata';
    if (path.indexOf('camera.') === 0) return 'camera';
    if (/^(?:spectrum|echo|lyrics|player)\./.test(path)) return 'global';
    return 'visual';
  }
  function collectDiffLeaves(value, prefix, output) {
    if (Array.isArray(value) || !plain(value)) {
      output[prefix] = copy(value);
      return;
    }
    var keys = Object.keys(value);
    if (!keys.length) {
      output[prefix] = {};
      return;
    }
    keys.forEach(function (key) {
      collectDiffLeaves(value[key], prefix ? prefix + '.' + key : key, output);
    });
  }
  function diff(current, incoming, options) {
    options = options || {};
    var before = options.raw === true ? copy(current || {}) : normalize(current || {}, { allowEmpty:true, collectErrors:true }).canonical;
    var after = options.raw === true ? copy(incoming || {}) : normalize(incoming || {}, { allowEmpty:true, collectErrors:true }).canonical;
    var beforeLeaves = {};
    var afterLeaves = {};
    collectDiffLeaves(before, '', beforeLeaves);
    collectDiffLeaves(after, '', afterLeaves);
    var mode = '';
    var paths = Object.keys(beforeLeaves).concat(Object.keys(afterLeaves)).filter(function (path,index,list) {
      return path && list.indexOf(path) === index;
    }).sort();
    var rows = paths.map(function (path) {
      var beforePresent = own(beforeLeaves,path);
      var afterPresent = own(afterLeaves,path);
      var changed = beforePresent !== afterPresent || !deepEqual(beforeLeaves[path],afterLeaves[path]);
      var category = diffCategory(path);
      return {
        path:path, canonicalPath:path, beforePresent:beforePresent, afterPresent:afterPresent,
        before:beforePresent ? copy(beforeLeaves[path]) : undefined,
        after:afterPresent ? copy(afterLeaves[path]) : undefined,
        changed:changed,
        status:!beforePresent ? 'added' : (!afterPresent ? 'removed' : (changed ? 'changed' : 'unchanged')),
        category:category, consumer:consumerForPath(path,mode)
      };
    });
    var changedRows = rows.filter(function (row) { return row.changed; });
    return {
      changed:changedRows.length > 0,
      rows:rows,
      changedFields:changedRows,
      unchangedFields:rows.filter(function (row) { return !row.changed; }),
      statistics:{
        metadataFields:rows.filter(function (row) { return row.category === 'metadata'; }).length,
        visualChangedFields:changedRows.filter(function (row) { return row.category === 'visual'; }).length,
        visualUnchangedFields:rows.filter(function (row) { return !row.changed && row.category === 'visual'; }).length,
        interactionChangedFields:changedRows.filter(function (row) { return row.category === 'interaction'; }).length,
        cameraChangedFields:changedRows.filter(function (row) { return row.category === 'camera'; }).length,
        globalChangedFields:changedRows.filter(function (row) { return row.category === 'global'; }).length
      }
    };
  }

  function validate(payload, options) {
    options = options || {};
    try {
      var report = normalize(payload, Object.assign({}, options, { collectErrors:true }));
      var valid = report.invalidFields.length === 0 && (options.strictUnknown !== true || report.ignoredFields.length === 0);
      return { ok:valid, valid:valid, canonical:report.canonical, mode:report.mode, report:report, errors:report.invalidFields.slice() };
    } catch (error) {
      return {
        ok:false, valid:false, canonical:error.report && error.report.canonical || null,
        mode:error.report && error.report.mode || '', report:error.report || null,
        errors:error.report && error.report.invalidFields || [{ sourcePath:'$', reason:error.message, code:error.code || 'SCHEMA_ERROR', critical:true }],
        error:{ code:error.code || 'SCHEMA_ERROR', message:error.message }
      };
    }
  }

  function migrate(payload, options) {
    var report = normalize(payload, Object.assign({}, options || {}, { collectErrors:true }));
    return {
      ok:report.invalidFields.length === 0,
      sourceVersion:report.source.version,
      targetVersion:VERSION,
      canonical:copy(report.canonical),
      migrations:copy(report.migrations),
      migrationRecords:copy(report.migrationRecords),
      report:report
    };
  }

  function preflight(payload, options) {
    options = options || {};
    var report;
    try {
      report = normalize(payload, Object.assign({}, options, { collectErrors:true }));
    } catch (error) {
      return {
        ok:false, valid:false, canonical:error.report && error.report.canonical || null,
        shadowState:null, mode:error.report && error.report.mode || '', report:error.report || null,
        errors:error.report && error.report.invalidFields || [{ sourcePath:'$', reason:error.message, code:error.code || 'SCHEMA_ERROR', critical:true }],
        error:{ code:error.code || 'SCHEMA_ERROR', message:error.message }
      };
    }
    var shadow = copy(report.canonical);
    var mode = '';
    var requested = null;
    var budget = null;
    var effective = null;
    var lodAdjustedFields = [];
    report.rejectedFields = report.invalidFields.slice();
    report.lodAdjustedFields = lodAdjustedFields;
    var difference = diff(options.current || {}, shadow, { raw:true });
    report.statistics = Object.assign({}, report.statistics, difference.statistics, {
      migratedFields:report.migrationRecords.length,
      lodAdjustedFields:lodAdjustedFields.length,
      ignoredFields:report.ignoredFields.length,
      rejectedFields:report.invalidFields.length
    });
    var valid = report.invalidFields.length === 0 && (options.strictUnknown !== true || report.ignoredFields.length === 0);
    return {
      ok:valid, valid:valid, canonical:copy(report.canonical), shadowState:shadow, mode:mode,
      report:report, diff:difference, requestedParticleCount:requested, effectiveParticleCount:effective,
      lod:{ adjusted:lodAdjustedFields.length > 0, requested:requested, budget:budget, effective:effective, fields:lodAdjustedFields },
      errors:report.invalidFields.slice()
    };
  }
  function preview(payload, options) { return preflight(payload, options || {}); }

  function createTransaction(currentState, payload, options) {
    options = options || {};
    var check = preflight(payload, Object.assign({}, options, { current:currentState || {} }));
    var snapshot = copy(currentState || {});
    var shadow = copy(check.shadowState);
    var state = check.valid ? 'prepared' : 'invalid';
    var lastResult = null;
    function preview() {
      return {
        ok:check.valid, valid:check.valid, state:state, mode:check.mode,
        snapshot:copy(snapshot), shadowState:copy(shadow), report:copy(check.report),
        diff:copy(check.diff), lod:copy(check.lod), errors:copy(check.errors)
      };
    }
    function injected(stage, hooks) {
      var requested = String((hooks && hooks.failAtStage) || options.failAtStage || '');
      if (requested === stage || (stage === 'after-apply' && requested === 'after-renderer')) {
        var error = new Error('事务故障注入：' + requested);
        error.code = 'INJECTED_TRANSACTION_FAILURE';
        error.stage = requested;
        throw error;
      }
    }
    async function commit(hooks) {
      hooks = hooks || {};
      if (!check.valid) return { ok:false, state:'invalid', report:check.report, errors:check.errors, rollback:{ attempted:false, succeeded:false, error:null } };
      if (state !== 'prepared') return { ok:false, state:state, report:check.report, error:{ code:'TRANSACTION_STATE_INVALID', message:'事务状态不允许再次提交' }, rollback:{ attempted:false, succeeded:false, error:null } };
      state = 'committing';
      var captured = snapshot;
      var staged = null;
      var rollback = { attempted:false, succeeded:false, error:null };
      try {
        if (typeof hooks.capture === 'function') {
          var capturedValue = await hooks.capture(copy(snapshot), { mode:check.mode, report:check.report });
          if (capturedValue !== undefined) captured = copy(capturedValue);
        }
        injected('after-capture',hooks);
        if (typeof hooks.stage === 'function') staged = await hooks.stage(copy(shadow), { mode:check.mode, report:check.report, diff:check.diff });
        injected('after-stage',hooks);
        if (typeof hooks.apply === 'function') await hooks.apply(copy(shadow), staged, { mode:check.mode, report:check.report, diff:check.diff });
        injected('after-apply',hooks);
        if (typeof hooks.persist === 'function') await hooks.persist(copy(shadow), { mode:check.mode, report:check.report, diff:check.diff });
        injected('after-persist',hooks);
        state = 'committed';
        lastResult = { ok:true, state:state, canonical:copy(check.canonical), shadowState:copy(shadow), report:check.report, diff:check.diff, rollback:rollback };
        return lastResult;
      } catch (error) {
        rollback.attempted = true;
        try {
          if (typeof hooks.rollback === 'function') await hooks.rollback(copy(captured), { mode:check.mode, report:check.report, failedStage:error.stage || '', error:error });
          rollback.succeeded = true;
        } catch (rollbackError) {
          rollback.error = { code:rollbackError.code || 'ROLLBACK_FAILED', message:rollbackError.message };
        }
        try {
          if (typeof hooks.dispose === 'function') await hooks.dispose(staged, { mode:check.mode, report:check.report, error:error });
        } catch (disposeError) {
          if (!rollback.error) rollback.error = { code:disposeError.code || 'DISPOSE_FAILED', message:disposeError.message };
        }
        state = rollback.succeeded ? 'rolled-back' : 'rollback-failed';
        check.report.transaction = { state:state, failedStage:error.stage || '', rollback:copy(rollback) };
        lastResult = {
          ok:false, state:state, canonical:copy(check.canonical), shadowState:copy(shadow),
          report:check.report, diff:check.diff,
          error:{ code:error.code || 'TRANSACTION_COMMIT_FAILED', message:error.message, stage:error.stage || '' },
          rollback:rollback
        };
        if (options.throwOnError === true) {
          error.transactionResult = lastResult;
          throw error;
        }
        return lastResult;
      }
    }
    async function rollbackNow(hooks) {
      hooks = hooks || {};
      var result = { attempted:true, succeeded:false, error:null };
      try {
        if (typeof hooks.rollback === 'function') await hooks.rollback(copy(snapshot), { mode:check.mode, report:check.report, explicit:true });
        result.succeeded = true;
        state = 'rolled-back';
      } catch (error) {
        result.error = { code:error.code || 'ROLLBACK_FAILED', message:error.message };
        state = 'rollback-failed';
      }
      return { ok:result.succeeded, state:state, rollback:result, report:check.report };
    }
    return {
      valid:check.valid, mode:check.mode, preview:preview, commit:commit, rollback:rollbackNow,
      getState:function () { return state; },
      getLastResult:function () { return lastResult; }
    };
  }

  async function atomicApply(currentState, payload, hooks, options) {
    return createTransaction(currentState,payload,options || {}).commit(hooks || {});
  }

  function verifyRoundTrip(value, options) {
    options = options || {};
    try {
      var canonical = orderedCanonical(value);
      var serialized = serialize(canonical, options.space == null ? 2 : options.space);
      var reparsed = parse(serialized, { fileName:options.fileName || 'round-trip.json' });
      var orderedAgain = orderedCanonical(reparsed.canonical);
      var difference = diff(canonical,orderedAgain,{ raw:true });
      return {
        ok:!difference.changed && reparsed.invalidFields.length === 0 && reparsed.ignoredFields.length === 0,
        canonical:canonical, serialized:serialized, reimported:orderedAgain, report:reparsed, diff:difference
      };
    } catch (error) {
      return { ok:false, canonical:null, serialized:'', reimported:null, report:error.report || null, diff:null, error:{ code:error.code || 'ROUND_TRIP_FAILED', message:error.message } };
    }
  }

  var MIGRATION_DEFINITIONS = [];
  Object.keys(KEY_ALIASES).forEach(function (namespace) {
    Object.keys(KEY_ALIASES[namespace]).forEach(function (oldKey) {
      var alias = KEY_ALIASES[namespace][oldKey];
      var target = typeof alias === 'string' ? alias : alias.key;
      MIGRATION_DEFINITIONS.push({
        sourceVersion:0, targetVersion:VERSION, oldPath:namespace + '.' + oldKey,
        newPath:namespace + '.' + target, valueTransform:typeof alias === 'string' ? 'identity' : 'registered-transform',
        warning:'旧字段别名', reversible:typeof alias === 'string'
      });
    });
  });
  var MODE_FIELDS = {};
  var FIELD_REGISTRY = {};
  Object.keys(SPECS).forEach(function (namespace) {
    Object.keys(SPECS[namespace]).forEach(function (key) {
      var path = namespace + '.' + key;
      FIELD_REGISTRY[path] = {
        path:path, namespace:namespace, spec:SPECS[namespace][key], consumer:consumerForPath(path,''),
        consumptionStatus:consumptionStatusForPath(path), modes:[]
      };
    });
  });
  var fields = {};
  Object.keys(SPECS).forEach(function (namespace) { fields[namespace] = Object.keys(SPECS[namespace]); });
  return Object.freeze({
    TYPE:TYPE, SCHEMA:SCHEMA, VERSION:VERSION, EFFECT_SCHEMA_VERSION:EFFECT_SCHEMA_VERSION,
    BUILTIN_PRESETS:BUILTIN_PRESETS, RETIRED_CUSTOM_MODES:RETIRED_CUSTOM_MODES, RETIRED_PRESET_NAMES:RETIRED_PRESET_NAMES,
    FIELDS:Object.freeze(fields), MODES:Object.freeze(MODE_DEFINITIONS), MODE_FIELDS:Object.freeze(MODE_FIELDS),
    FIELD_REGISTRY:Object.freeze(FIELD_REGISTRY), MIGRATIONS:Object.freeze(MIGRATION_DEFINITIONS),
    normalize:normalize, parse:parse, serialize:serialize, sanitizeForShare:sanitizeForShare, isRetiredPreset:function (value) { return !!retiredPresetIdentity(value); },
    validate:validate, preflight:preflight, preview:preview, diff:diff, deepEqual:deepEqual, migrate:migrate,
    createTransaction:createTransaction, atomicApply:atomicApply, verifyRoundTrip:verifyRoundTrip
  });
});
