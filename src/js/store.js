/* store.js — localStorage 데이터 레이어 (읽기 / 쓰기 / 마이그레이션) */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  // 저장 키는 앱 네임스페이스라 고정. 데이터 모양이 바뀌면 SCHEMA_VERSION 만 올린다.
  var STORAGE_KEY = 'fitlog.v1';
  var SCHEMA_VERSION = 2;

  /* ---------- 기본값 ---------- */

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      profile: null,          // 온보딩 완료 전에는 null
      targets: null,          // profile 기반 자동 계산
      supplements: [],
      dailyLogs: {},
      bodyLogs: [],
      customFoods: [],
      favorites: [],    // 'template:<id>' / 'food:<id>' / 'custom:<id>'
      meta: { lastBackupAt: null }   // 마지막 백업 시각. 데이터 유실 노출도를 보여주는 데 쓴다
    };
  }

  function emptyDay() {
    return {
      meals: [],
      alcohol: { drank: false, kcal: 0, note: '' },
      supplementsTaken: [],
      workouts: [],
      waterMl: 0,
      note: ''
    };
  }

  /* ---------- 날짜 유틸 (로컬 타임존 기준 YYYY-MM-DD) ---------- */

  // 이 앱은 ES5 문법·내장 함수만 쓴다. 구형 모바일 브라우저에서 스크립트가 통째로
  // 죽는 걸 막기 위해서다. padStart(ES2017) 대신 직접 두 자리로 채운다.
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function todayKey(d) {
    var t = d ? new Date(d) : new Date();
    return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
  }

  /* ---------- 마이그레이션 ----------
     저장된 데이터의 schemaVersion 이 현재보다 낮으면 단계별로 올린다.
     지금은 v1 이 최초 버전이라 실제 변환 단계는 없고,
     누락 필드를 채워 넣는 정규화만 수행한다. */

  var migrations = {
    // v1 → v2: 목표가 단일 선택(goal)에서 복수 선택(goals)으로 바뀌었다.
    1: function (s) {
      upgradeProfileGoals(s.profile);
      s.schemaVersion = 2;
      return s;
    }
  };

  /** profile.goal(문자열) → profile.goals(배열). 이미 배열이면 그대로 둔다. */
  function upgradeProfileGoals(profile) {
    if (!profile || typeof profile !== 'object') return profile;
    if (!Array.isArray(profile.goals)) {
      profile.goals = profile.goal ? [profile.goal] : ['maintain'];
    }
    delete profile.goal;
    return profile;
  }

  function migrate(raw) {
    var state = raw && typeof raw === 'object' ? raw : emptyState();
    var version = Number(state.schemaVersion) || 0;

    while (version < SCHEMA_VERSION && migrations[version]) {
      state = migrations[version](state);
      version = Number(state.schemaVersion) || version + 1;
    }

    // 미래 버전 데이터를 읽은 경우(다른 기기에서 최신 앱 사용) — 덮어쓰지 않고 그대로 둔다.
    if (version > SCHEMA_VERSION) return state;

    return normalize(state);
  }

  function normalize(state) {
    var base = emptyState();
    if (!state || typeof state !== 'object') return base;

    // 마이그레이션을 거치지 않고 들어온 데이터(직접 만든 백업 등)를 위한 안전망.
    base.profile = upgradeProfileGoals(state.profile) || null;
    base.targets = state.targets || null;
    base.supplements = Array.isArray(state.supplements) ? state.supplements : [];
    base.bodyLogs = Array.isArray(state.bodyLogs) ? state.bodyLogs : [];
    base.customFoods = Array.isArray(state.customFoods) ? state.customFoods : [];
    // favorites 는 나중에 추가된 필드다. 값을 바꾸는 게 아니라 빈 배열을 채우기만 하면 되므로
    // 스키마 버전을 올리지 않고 여기서 정규화한다. (goals 처럼 기존 값을 '변환'해야 할 때만 마이그레이션)
    base.favorites = Array.isArray(state.favorites) ? state.favorites : [];

    var meta = state.meta && typeof state.meta === 'object' ? state.meta : {};
    base.meta = { lastBackupAt: meta.lastBackupAt || null };

    base.dailyLogs = {};
    if (state.dailyLogs && typeof state.dailyLogs === 'object') {
      Object.keys(state.dailyLogs).forEach(function (key) {
        var src = state.dailyLogs[key] || {};
        var day = emptyDay();
        day.meals = Array.isArray(src.meals) ? src.meals : [];
        day.alcohol = normalizeAlcohol(src.alcohol);
        day.supplementsTaken = Array.isArray(src.supplementsTaken) ? src.supplementsTaken : [];
        day.workouts = Array.isArray(src.workouts) ? src.workouts : [];
        day.waterMl = Number(src.waterMl) || 0;
        day.note = typeof src.note === 'string' ? src.note : '';
        base.dailyLogs[key] = day;
      });
    }

    return base;
  }

  /** 음주 기록 정규화. alcohol 필드는 나중에 추가된 항목이라 없는 날이 있을 수 있다. */
  function normalizeAlcohol(src) {
    var a = src && typeof src === 'object' ? src : {};
    return {
      drank: a.drank === true,
      kcal: Number(a.kcal) || 0,
      note: typeof a.note === 'string' ? a.note : ''
    };
  }

  /* ---------- 읽기 / 쓰기 ---------- */

  var cache = null;

  function load() {
    if (cache) return cache;
    var raw = null;
    try {
      var text = localStorage.getItem(STORAGE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch (e) {
      console.warn('[FitLog] 저장된 데이터를 읽지 못했습니다. 새로 시작합니다.', e);
      raw = null;
    }
    cache = migrate(raw);
    return cache;
  }

  function save(state) {
    cache = state || cache;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      return true;
    } catch (e) {
      console.error('[FitLog] 저장 실패', e);
      return false;
    }
  }

  /** 상태를 함수로 변경하고 저장. mutator 가 값을 반환하면 그 값을 새 상태로 쓴다. */
  function update(mutator) {
    var state = load();
    var next = mutator(state);
    save(next || state);
    return cache;
  }

  /** 저장된 데이터를 통째로 교체 (불러오기 / 초기화용) */
  function replace(raw) {
    cache = migrate(raw);
    save(cache);
    return cache;
  }

  function reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('[FitLog] 초기화 실패', e);
    }
    cache = emptyState();
    return cache;
  }

  function hasProfile() {
    var p = load().profile;
    return !!(p && p.height && p.age && p.sex && p.weight);
  }

  /** 특정 날짜 로그를 가져온다. 없으면 빈 로그를 만들어 반환(저장은 하지 않음). */
  function getDay(dateKey) {
    var key = dateKey || todayKey();
    var state = load();
    return state.dailyLogs[key] || emptyDay();
  }

  /* ---------- 식사 기록 ---------- */

  var idSeq = 0;

  function newId(prefix) {
    idSeq += 1;
    return prefix + '_' + Date.now().toString(36) + '_' + idSeq;
  }

  /** 해당 날짜 로그를 꺼내온다. 없으면 만들어 붙인다. */
  function ensureDay(state, dateKey) {
    if (!state.dailyLogs[dateKey]) state.dailyLogs[dateKey] = emptyDay();
    return state.dailyLogs[dateKey];
  }

  /**
   * 끼니를 기록한다. nutrients 는 저장 시점 계산값을 그대로 넣는다 —
   * 나중에 음식 DB 값이 바뀌어도 과거 기록은 그대로 남아야 하기 때문.
   */
  function addMeal(dateKey, meal) {
    var key = dateKey || todayKey();
    var record = {
      id: meal.id || newId('meal'),
      type: meal.type || 'snack',
      sourceKind: meal.sourceKind || 'template',
      sourceId: meal.sourceId || null,
      label: meal.label || '',
      portion: Number(meal.portion) || 1,
      items: Array.isArray(meal.items) ? meal.items : null,
      nutrients: meal.nutrients || {},
      time: meal.time || '',
      note: meal.note || ''
    };

    update(function (state) {
      ensureDay(state, key).meals.push(record);
      return state;
    });

    return record;
  }

  function removeMeal(dateKey, mealId) {
    var key = dateKey || todayKey();
    update(function (state) {
      var day = state.dailyLogs[key];
      if (!day) return state;
      day.meals = day.meals.filter(function (m) { return m.id !== mealId; });
      return state;
    });
  }

  /** 하루치 식사 영양소 합계 */
  function dayNutrients(dateKey) {
    var day = getDay(dateKey);
    return FitLog.foods.sum(day.meals.map(function (m) { return m.nutrients; }));
  }

  /**
   * 하루 영양소 합계 — 끼니 + **그날 체크한 보충제**.
   *
   * 화면에 보이는 숫자는 전부 이걸 써야 한다. `dayNutrients()` 는 끼니만 더한다.
   * 오늘 탭 상단 링이 끼니만 세는 바람에, 유청 단백질(24g/120kcal)을 먹고 체크해도
   * 칼로리·단백질이 그대로였다. 같은 화면 아래 알림 카드는 보충제를 세고 있어서
   * **한 화면에 서로 다른 숫자가 두 개** 있었다.
   *
   * 스펙: '단백질 보충제는 protein(g)/kcal 도 채워서 매크로 합계에 반영되게 한다.'
   */
  function dayTotals(dateKey) {
    var key = dateKey || todayKey();
    var day = getDay(key);

    var food = FitLog.foods.sum(day.meals.map(function (m) { return m.nutrients; }));
    var supp = FitLog.supplements.dailyNutrients(load().supplements, day.supplementsTaken);

    var out = {};
    FitLog.foods.KEYS.forEach(function (k) {
      out[k] = (Number(food[k]) || 0) + (Number(supp[k]) || 0);
    });
    return out;
  }

  /** 그날 체크한 보충제에서 온 몫만. 숫자가 왜 늘었는지 설명할 때 쓴다. */
  function daySupplementNutrients(dateKey) {
    var day = getDay(dateKey);
    return FitLog.supplements.dailyNutrients(load().supplements, day.supplementsTaken);
  }

  /* ---------- 운동 기록 ---------- */

  function addWorkout(dateKey, workout) {
    var key = dateKey || todayKey();
    var record = {
      id: workout.id || newId('wk'),
      type: workout.type === 'cardio' ? 'cardio' : 'strength',
      minutes: Number(workout.minutes) || 0,
      bodyParts: Array.isArray(workout.bodyParts) ? workout.bodyParts : [],
      intensity: workout.intensity || null,
      note: workout.note || ''
    };

    update(function (state) {
      ensureDay(state, key).workouts.push(record);
      return state;
    });

    return record;
  }

  function removeWorkout(dateKey, workoutId) {
    var key = dateKey || todayKey();
    update(function (state) {
      var day = state.dailyLogs[key];
      if (!day) return state;
      day.workouts = day.workouts.filter(function (w) { return w.id !== workoutId; });
      return state;
    });
  }

  /* ---------- 인바디 측정 ---------- */

  /** 같은 날짜 기록이 있으면 덮어쓴다. 하루에 두 번 재도 마지막 값만 남기는 게 맞다. */
  function saveBodyLog(entry) {
    var record = {
      date: entry.date || todayKey(),
      weight: Number(entry.weight),
      skeletalMuscle: entry.skeletalMuscle === '' || entry.skeletalMuscle === null
        ? null : Number(entry.skeletalMuscle),
      bodyFatPct: entry.bodyFatPct === '' || entry.bodyFatPct === null
        ? null : Number(entry.bodyFatPct),
      visceralRatio: entry.visceralRatio === '' || entry.visceralRatio === null
        ? null : Number(entry.visceralRatio),
      waistCm: entry.waistCm === '' || entry.waistCm === null
        ? null : Number(entry.waistCm)
    };

    update(function (state) {
      state.bodyLogs = state.bodyLogs.filter(function (l) { return l.date !== record.date; });
      state.bodyLogs.push(record);
      state.bodyLogs.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

      // 가장 최근 측정은 프로필 체중에도 반영한다. 목표치가 옛 체중에 묶이면 안 된다.
      var last = state.bodyLogs[state.bodyLogs.length - 1];
      if (state.profile && last && last.weight) {
        state.profile.weight = last.weight;
        if (last.bodyFatPct !== null) state.profile.bodyFatPct = last.bodyFatPct;
        if (last.skeletalMuscle !== null) state.profile.skeletalMuscle = last.skeletalMuscle;
        state.targets = FitLog.calc.computeTargets(state.profile);
      }
      return state;
    });

    return record;
  }

  function removeBodyLog(date) {
    update(function (state) {
      state.bodyLogs = state.bodyLogs.filter(function (l) { return l.date !== date; });
      return state;
    });
  }

  /* ---------- 보충제 ---------- */

  function addSupplement(sup) {
    var record = {
      id: sup.id || newId('sup'),
      name: sup.name || '',
      presetId: sup.presetId || null,
      timeSlot: sup.timeSlot || 'morning',
      dailyDoses: Number(sup.dailyDoses) || 1,
      nutrients: sup.nutrients || {},
      enabled: sup.enabled !== false
    };

    update(function (state) {
      state.supplements.push(record);
      return state;
    });

    return record;
  }

  function updateSupplement(id, patch) {
    update(function (state) {
      state.supplements.forEach(function (sup) {
        if (sup.id !== id) return;
        Object.keys(patch).forEach(function (k) { sup[k] = patch[k]; });
      });
      return state;
    });
  }

  function removeSupplement(id) {
    update(function (state) {
      state.supplements = state.supplements.filter(function (s) { return s.id !== id; });
      // 지난 기록의 체크 표시도 같이 정리한다. 안 그러면 없는 보충제를 먹은 걸로 남는다.
      Object.keys(state.dailyLogs).forEach(function (day) {
        var log = state.dailyLogs[day];
        log.supplementsTaken = log.supplementsTaken.filter(function (s) { return s !== id; });
      });
      return state;
    });
  }

  function isTaken(dateKey, supId) {
    return getDay(dateKey).supplementsTaken.indexOf(supId) >= 0;
  }

  /** 오늘 먹었는지 표시를 켜고 끈다. 반환값은 바뀐 뒤 상태. */
  function toggleTaken(dateKey, supId) {
    var key = dateKey || todayKey();
    var on = false;

    update(function (state) {
      var day = ensureDay(state, key);
      var at = day.supplementsTaken.indexOf(supId);
      if (at >= 0) day.supplementsTaken.splice(at, 1);
      else { day.supplementsTaken.push(supId); on = true; }
      return state;
    });

    return on;
  }

  /* ---------- 백업 이력 ----------
     localStorage 는 영구 저장이 아니다. iOS 는 한동안 안 쓴 사이트의 저장 데이터를
     지울 수 있고, 브라우저 기록을 지워도 같이 사라진다.
     유일한 확실한 대비가 백업이므로, 마지막으로 언제 백업했는지를 기록해 두고
     너무 오래됐으면 알려준다. */

  function markBackedUp(when) {
    var at = when || new Date().toISOString();
    update(function (state) {
      state.meta.lastBackupAt = at;
      return state;
    });
    return at;
  }

  /** 마지막 백업 이후 며칠 지났는지. 백업한 적이 없으면 null. */
  function daysSinceBackup() {
    var at = load().meta.lastBackupAt;
    if (!at) return null;

    var then = new Date(at).getTime();
    if (isNaN(then)) return null;

    return Math.floor((Date.now() - then) / 86400000);
  }

  /** 기록이 며칠치 쌓였는지 — 잃을 게 얼마나 되는지 판단하는 데 쓴다 */
  function recordedDayCount() {
    var logs = load().dailyLogs;
    return Object.keys(logs).filter(function (d) {
      var log = logs[d];
      return log.meals.length || log.workouts.length || log.supplementsTaken.length;
    }).length;
  }

  /* ---------- 즐겨찾기 ---------- */

  function favKey(kind, id) { return kind + ':' + id; }

  function isFavorite(kind, id) {
    return load().favorites.indexOf(favKey(kind, id)) >= 0;
  }

  /** 즐겨찾기를 켜고 끈다. 반환값은 바뀐 뒤 상태(true = 즐겨찾기됨). */
  function toggleFavorite(kind, id) {
    var key = favKey(kind, id);
    var on = false;

    update(function (state) {
      var at = state.favorites.indexOf(key);
      if (at >= 0) state.favorites.splice(at, 1);
      else { state.favorites.push(key); on = true; }
      return state;
    });

    return on;
  }

  /* ---------- 직접 등록한 음식 ---------- */

  /**
   * 사용자가 직접 등록한 음식. 100g이 아니라 '1회 먹는 양' 기준으로 저장한다.
   * 비개발자가 100g 환산을 하게 만들면 안 되기 때문.
   */
  function addCustomFood(input) {
    var food = {
      id: newId('custom'),
      name: String(input.name || '').trim(),
      nutrients: input.nutrients || {},
      createdAt: todayKey()
    };

    update(function (state) {
      state.customFoods.push(food);
      return state;
    });

    return food;
  }

  function getCustomFood(id) {
    var hits = load().customFoods.filter(function (f) { return f.id === id; });
    return hits[0] || null;
  }

  function removeCustomFood(id) {
    update(function (state) {
      state.customFoods = state.customFoods.filter(function (f) { return f.id !== id; });
      state.favorites = state.favorites.filter(function (k) { return k !== favKey('custom', id); });
      return state;
    });
  }

  FitLog.store = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    emptyState: emptyState,
    emptyDay: emptyDay,
    todayKey: todayKey,
    migrate: migrate,
    load: load,
    save: save,
    update: update,
    replace: replace,
    reset: reset,
    hasProfile: hasProfile,
    getDay: getDay,
    newId: newId,
    addMeal: addMeal,
    removeMeal: removeMeal,
    dayNutrients: dayNutrients,
    dayTotals: dayTotals,
    daySupplementNutrients: daySupplementNutrients,
    addWorkout: addWorkout,
    removeWorkout: removeWorkout,
    saveBodyLog: saveBodyLog,
    removeBodyLog: removeBodyLog,
    addSupplement: addSupplement,
    updateSupplement: updateSupplement,
    removeSupplement: removeSupplement,
    isTaken: isTaken,
    toggleTaken: toggleTaken,
    markBackedUp: markBackedUp,
    daysSinceBackup: daysSinceBackup,
    recordedDayCount: recordedDayCount,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    addCustomFood: addCustomFood,
    getCustomFood: getCustomFood,
    removeCustomFood: removeCustomFood
  };
})(window.FitLog);
