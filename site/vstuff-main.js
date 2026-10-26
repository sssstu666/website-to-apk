
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}

var deferredInstallPrompt = null;
var installBtn = document.getElementById('installBtn');

window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn.classList.add('visible');
});

installBtn.addEventListener('click', function () {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.finally(function () {
    deferredInstallPrompt = null;
    installBtn.classList.remove('visible');
  });
});

window.addEventListener('appinstalled', function () {
  installBtn.classList.remove('visible');
});

var lastResult = null;
var activeTab = 'chart';

function mapConvertedDirection(mustHit, noteData) {
  return mustHit ? noteData : (noteData + 4) % 8;
}

var NOTE_KIND_TABLE = {
  'Alt Animation': 'Alt Animation',
  'Hurt Note': 'Hurt Note',
  'No Animation': 'No Animation',
  'Bullet Note': 'Bullet Note',
  'Hey!': 'Hey!'
};

function mapNoteKind(kind) {
  return NOTE_KIND_TABLE[kind] || kind;
}

function mapCharacterTarget(name) {
  if (!name) return 'player';
  var lower = String(name).toLowerCase();
  if (lower === 'dad' || lower === 'opponent') return 'opponent';
  if (lower === 'gf' || lower === 'girlfriend') return 'girlfriend';
  return 'player';
}

function roundTime(t) {
  return Math.round(t * 1000) / 1000;
}

function mapSingleEvent(name, p1, p2, time, zoomState) {
  if (name === 'Play Animation') {
    return [{
      t: roundTime(time),
      e: 'PlayAnimation',
      v: { force: true, anim: p1 || '', target: mapCharacterTarget(p2) }
    }];
  }

  if (name === 'Add Camera Zoom') {
    var amount = parseFloat(p1);
    if (isNaN(amount)) amount = 0;
    var key = (p2 && String(p2).length) ? p2 : 'default';
    if (!(key in zoomState)) zoomState[key] = 1;
    zoomState[key] = zoomState[key] + amount;
    return [{
      t: roundTime(time),
      e: 'ZoomCamera',
      v: { ease: 'linear', duration: 0, zoom: Math.round(zoomState[key] * 1000) / 1000, mode: key === 'default' ? 'stage' : key }
    }];
  }

  if (name === 'Flash Camera' || name === 'flash') {
    var duration = parseFloat(p1);
    if (isNaN(duration)) duration = 0.5;
    return [{
      t: roundTime(time),
      e: 'FlashCamera',
      v: { duration: duration, color: '#FFFFFF', target: p2 && p2.length ? p2 : 'camGame' }
    }];
  }

  return [{
    t: roundTime(time),
    e: name,
    v: { p1: p1 === undefined ? '' : p1, p2: p2 === undefined ? '' : p2 }
  }];
}

function convertPsychEvents(events) {
  var out = [];
  var zoomState = {};
  for (var i = 0; i < events.length; i++) {
    var time = events[i][0];
    var list = events[i][1] || [];
    for (var j = 0; j < list.length; j++) {
      var entry = list[j];
      var mapped = mapSingleEvent(entry[0], entry[1], entry[2], time, zoomState);
      for (var k = 0; k < mapped.length; k++) out.push(mapped[k]);
    }
  }
  out.sort(function (a, b) { return a.t - b.t; });
  return out;
}

function convertNotesAndTimeChanges(song) {
  var sections = song.notes || [];
  var notesOut = [];
  var timeChanges = [];
  var runningBeat = 0;
  var startBpm = (sections.length && sections[0].bpm) || song.bpm || 100;
  var lastBpm = startBpm;
  var sectionStartTime = 0;

  timeChanges.push({ t: 0, b: 0, bpm: startBpm, bt: [4, 4, 4, 4] });

  for (var i = 0; i < sections.length; i++) {
    var section = sections[i];
    var sectionBpm = section.bpm || lastBpm;

    if (section.changeBPM && sectionBpm !== lastBpm) {
      timeChanges.push({
        t: Math.round(sectionStartTime),
        b: Math.round(runningBeat),
        bpm: sectionBpm,
        bt: [4, 4, 4, 4]
      });
      lastBpm = sectionBpm;
    }

    var sectionNotes = section.sectionNotes || [];
    for (var n = 0; n < sectionNotes.length; n++) {
      var note = sectionNotes[n];
      var time = note[0];
      var noteData = note[1];
      var sustain = note[2];
      var kind = note[3];

      var outNote = { t: roundTime(time), d: mapConvertedDirection(section.mustHitSection, noteData) };
      if (sustain && sustain > 0) outNote.l = roundTime(sustain);
      if (kind) outNote.k = mapNoteKind(kind);
      notesOut.push(outNote);
    }

    var beats = section.sectionBeats !== undefined ? section.sectionBeats : (section.lengthInSteps !== undefined ? section.lengthInSteps / 4 : 4);
    var msPerBeat = 60000 / sectionBpm;
    sectionStartTime += beats * msPerBeat;
    runningBeat += beats;
  }

  notesOut.sort(function (a, b) { return a.t - b.t; });

  return { notes: notesOut, timeChanges: timeChanges };
}

function cloneNotes(notes) {
  return JSON.parse(JSON.stringify(notes));
}

function convertPsychChart(psychJson, meta) {
  var song = psychJson.song;
  if (!song) throw new Error('Missing "song" root key — this doesn\'t look like a Psych chart.');

  var noteResult = convertNotesAndTimeChanges(song);
  var eventsOut = convertPsychEvents(song.events || []);
  var speed = song.speed || 1;

  var chartOut = {
    version: '2.0.0',
    scrollSpeed: { easy: speed, normal: speed, hard: speed },
    events: eventsOut,
    notes: {
      easy: cloneNotes(noteResult.notes),
      normal: cloneNotes(noteResult.notes),
      hard: cloneNotes(noteResult.notes)
    },
    generatedBy: 'V Stuff'
  };

  var metadataOut = {
    version: '2.2.4',
    songName: meta.songName || song.song || 'Untitled',
    artist: meta.artist || '',
    charter: meta.charter || '',
    offsets: {},
    playData: {
      difficulties: ['easy', 'normal', 'hard'],
      characters: {
        player: song.player1 || 'bf',
        girlfriend: song.gfVersion || 'gf',
        opponent: song.player2 || 'dad',
        opponentVocals: [song.player2 || 'dad'],
        playerVocals: [song.player1 || 'bf']
      },
      stage: meta.stage || song.stage || 'mainStage',
      noteStyle: meta.noteStyle || 'funkin',
      ratings: { easy: 0, normal: 0, hard: 0 },
      album: meta.album || ''
    },
    generatedBy: 'V Stuff',
    timeChanges: noteResult.timeChanges
  };

  if (meta.altCharter) metadataOut.altCharter = meta.altCharter;
  if (meta.spriteArtist) metadataOut.spriteArtist = meta.spriteArtist;
  if (meta.cutsceneArtist) metadataOut.cutsceneArtist = meta.cutsceneArtist;
  if (meta.stickerPack) metadataOut.playData.stickerPack = meta.stickerPack;

  return { chart: chartOut, metadata: metadataOut };
}

function setStatus(text, kind) {
  var el = document.getElementById('status');
  el.textContent = text;
  el.className = kind || '';
}

function readMetaFields() {
  return {
    songName: document.getElementById('songName').value.trim(),
    artist: document.getElementById('artist').value.trim(),
    charter: document.getElementById('charter').value.trim(),
    album: document.getElementById('album').value.trim(),
    stage: document.getElementById('stage').value.trim(),
    noteStyle: document.getElementById('noteStyle').value.trim(),
    altCharter: document.getElementById('altCharter').value.trim(),
    spriteArtist: document.getElementById('spriteArtist').value.trim(),
    cutsceneArtist: document.getElementById('cutsceneArtist').value.trim(),
    stickerPack: document.getElementById('stickerPack').value.trim()
  };
}

function renderOutput() {
  var wrap = document.getElementById('outputWrap');
  var actions = document.getElementById('outputActions');

  if (!lastResult) {
    wrap.innerHTML = '<div class="empty-state">Convert a chart to see the output here.</div>';
    actions.style.display = 'none';
    return;
  }

  var data = activeTab === 'chart' ? lastResult.chart : lastResult.metadata;
  wrap.innerHTML = '<textarea id="outputArea" readonly spellcheck="false"></textarea>';
  document.getElementById('outputArea').value = JSON.stringify(data, null, 2);
  actions.style.display = 'flex';
}

document.getElementById('tabChart').addEventListener('click', function () {
  activeTab = 'chart';
  document.getElementById('tabChart').classList.add('active');
  document.getElementById('tabMeta').classList.remove('active');
  renderOutput();
});

document.getElementById('tabMeta').addEventListener('click', function () {
  activeTab = 'metadata';
  document.getElementById('tabMeta').classList.add('active');
  document.getElementById('tabChart').classList.remove('active');
  renderOutput();
});

document.getElementById('fileBtn').addEventListener('click', function () {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('fileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) {
    document.getElementById('psychInput').value = ev.target.result;
    trySuggestFields();
  };
  reader.readAsText(file);
});

document.getElementById('psychInput').addEventListener('blur', trySuggestFields);

function trySuggestFields() {
  var raw = document.getElementById('psychInput').value.trim();
  if (!raw) return;
  try {
    var parsed = safeJsonParse(raw);
    var song = parsed.song;
    if (!song) return;
    var songNameField = document.getElementById('songName');
    var stageField = document.getElementById('stage');
    if (!songNameField.value && song.song) songNameField.value = song.song;
    if (!stageField.value && song.stage) stageField.value = song.stage;
  } catch (err) {
    return;
  }
}

document.getElementById('convertBtn').addEventListener('click', function () {
  var raw = document.getElementById('psychInput').value.trim();
  if (!raw) {
    setStatus('Paste or upload a Psych chart first.', 'err');
    return;
  }

  var parsed;
  try {
    parsed = safeJsonParse(raw);
  } catch (err) {
    setStatus('That JSON doesn\'t parse: ' + err.message, 'err');
    return;
  }

  try {
    var meta = readMetaFields();
    lastResult = convertPsychChart(parsed, meta);
    var noteCount = lastResult.chart.notes.normal.length;
    var eventCount = lastResult.chart.events.length;
    setStatus('Converted ' + noteCount + ' notes and ' + eventCount + ' events.', 'ok');
    renderOutput();
  } catch (err) {
    setStatus('Conversion failed: ' + err.message, 'err');
  }
});

document.getElementById('copyBtn').addEventListener('click', function () {
  var area = document.getElementById('outputArea');
  if (!area) return;
  area.select();
  document.execCommand('copy');
  setStatus('Copied ' + (activeTab === 'chart' ? 'chart.json' : 'metadata.json') + ' to clipboard.', 'ok');
});

document.getElementById('downloadBtn').addEventListener('click', function () {
  if (!lastResult) return;
  var data = activeTab === 'chart' ? lastResult.chart : lastResult.metadata;
  var name = (readMetaFields().songName || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  var filename = activeTab === 'chart' ? name + '-chart.json' : name + '-metadata.json';
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

var ENGINE_LABELS = { vslice: 'V-Slice', psych: 'Psych', codename: 'Codename' };

var DIRECTION_MATRIX = {
  psych: {
    vslice: ['chartsPage', 'charactersPage', 'stagesPage', 'modFolderPage', 'weeksPage'],
    codename: ['universalNotBuiltPage', 'universalNotBuiltPage', 'universalNotBuiltPage', 'universalNotBuiltPage', 'universalNotBuiltPage']
  },
  vslice: {
    psych: ['chartsPageR', 'charactersPageR', 'stagesPageR', 'modFolderPageR', 'weeksPageR'],
    codename: ['codenamePageR', 'codenamePageR', 'codenamePageR', 'codenamePageR', 'codenamePageR']
  },
  codename: {
    vslice: ['codenamePage', 'codenameCharactersPage', 'codenameStagesPage', 'codenameNotBuiltPage', 'codenameNotBuiltPage'],
    psych: ['codenameToPsychPage', 'codenameToPsychCharactersPage', 'codenameToPsychStagesPage', 'codenameToPsychNotBuiltPage', 'codenameToPsychNotBuiltPage']
  }
};

var PAGE_NAV_IDS = ['navCharts', 'navCharacters', 'navStages', 'navModFolder', 'navWeeks'];
var currentFrom = 'psych';
var currentTo = 'vslice';
var currentTool = 0;

function getCurrentPages() {
  if (currentFrom === currentTo) return null;
  var row = DIRECTION_MATRIX[currentFrom];
  return row ? row[currentTo] : null;
}

function showPage() {
  var allPageIds = { universalNotBuiltPage: true, sameEngineNoticePage: true };
  Object.keys(DIRECTION_MATRIX).forEach(function (from) {
    Object.keys(DIRECTION_MATRIX[from]).forEach(function (to) {
      DIRECTION_MATRIX[from][to].forEach(function (id) { allPageIds[id] = true; });
    });
  });
  Object.keys(allPageIds).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });

  var pages = getCurrentPages();
  if (!pages) {
    document.getElementById('sameEngineNoticePage').classList.add('active');
  } else {
    document.getElementById(pages[currentTool]).classList.add('active');
  }

  PAGE_NAV_IDS.forEach(function (id, i) {
    document.getElementById(id).classList.toggle('active', currentTool === i);
  });

  ['engineFromButtons', 'engineToButtons'].forEach(function (groupId) {
    var isFrom = groupId === 'engineFromButtons';
    var current = isFrom ? currentFrom : currentTo;
    var buttons = document.getElementById(groupId).querySelectorAll('.engine-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].getAttribute('data-engine') === current);
    }
  });
}

function setupEnginePicker(groupId, isFrom) {
  var buttons = document.getElementById(groupId).querySelectorAll('.engine-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function (ev) {
      var engine = ev.currentTarget.getAttribute('data-engine');
      if (isFrom) currentFrom = engine; else currentTo = engine;
      currentTool = 0;
      showPage();
    });
  }
}

setupEnginePicker('engineFromButtons', true);
setupEnginePicker('engineToButtons', false);

PAGE_NAV_IDS.forEach(function (id, i) {
  document.getElementById(id).addEventListener('click', function () { currentTool = i; showPage(); });
});

var lastCharResult = null;

function isDeathAnimId(id) {
  if (!id) return false;
  var lower = String(id).toLowerCase();
  return lower.indexOf('death') !== -1 || lower === 'sad';
}

function classifyDeathAnim(id) {
  var lower = String(id).toLowerCase();
  if (lower.indexOf('loop') !== -1) return 'deathLoop';
  if (lower.indexOf('confirm') !== -1) return 'deathConfirm';
  return 'firstDeath';
}

function guessAssetPath(image) {
  if (!image) return 'shared:characters/character';
  return 'shared:' + String(image).toLowerCase();
}

function guessDisplayName(image) {
  if (!image) return 'Character';
  var last = String(image).split('/').pop();
  var words = last.replace(/[_-]+/g, ' ').toLowerCase().split(' ');
  for (var i = 0; i < words.length; i++) {
    if (words[i].length) words[i] = words[i][0].toUpperCase() + words[i].slice(1);
  }
  return words.join(' ');
}

var I18N = {
  en: {
    optionsTheme: 'Theme', optionsUiSound: 'UI sounds', optionsLanguage: 'Language', optionsEnglish: 'English', optionsPortuguese: 'Portuguese',
    headerDesc: "Converts a Psych Engine chart into the V-Slice chart and metadata format. Paste or upload a chart, fill in what Psych doesn't store, and get both output files.",
    installApp: 'Install app',
    navGenerator: 'Generator', navEditor: 'Editor', navOnline: 'Online',
    convertFrom: 'Convert from', convertTo: 'Convert to',
    navCharts: 'Charts', navCharacters: 'Characters', navStages: 'Stages', navModFolder: 'Mod Folder', navWeeks: 'Weeks',
    navEditorChart: 'Chart Editor', navEditorCharacter: 'Character Editor', navEditorStage: 'Stage Editor', navEditorWeek: 'Week Editor',
    introSkip: 'Tap to skip',
    onlineTitle: 'Community Showcase',
    onlineDesc: 'Posts here are public GitHub issues on this project\'s repo, tagged "showcase" — there\'s no separate database, so anyone can read them and anyone with a GitHub account can post one. Hit Submit to open a pre-filled issue on GitHub, fill it in, and it\'ll show up here once it\'s posted.',
    onlineSubmit: 'Submit your project', onlineRefresh: 'Refresh', onlineLoading: 'Loading projects…', onlineLoadMore: 'Load more',
    onlineSearchPlaceholder: 'Search projects…', onlineSortNewest: 'Newest', onlineSortOldest: 'Oldest', onlineSortReactions: 'Most liked', onlineSortComments: 'Most commented',
    optionsAccount: 'Account (optional)', optionsGoogleUnconfigured: "Google sign-in isn't set up on this deployment yet.", optionsSignOut: 'Sign out',
    optionsProfile: 'Your profile', optionsProfileDesc: "Optional — just a display name for this browser, stored locally. It's never sent anywhere on its own.",
    optionsProfileNamePlaceholder: 'Display name', optionsProfileVisible: 'Show my name when I submit a project to Online',
    optionsProfileVisibleOnHint: "Your name gets added to the pre-filled submission — you still post it yourself, nothing is automatic.",
    optionsProfileVisibleOffHint: "Your submissions will use a generic template with no name attached."
  },
  pt: {
    optionsTheme: 'Tema', optionsUiSound: 'Sons da interface', optionsLanguage: 'Idioma', optionsEnglish: 'Inglês', optionsPortuguese: 'Português',
    headerDesc: 'Converte um chart do Psych Engine para o formato de chart e metadata do V-Slice. Cole ou envie um chart, preencha o que o Psych não guarda, e baixe os dois arquivos.',
    installApp: 'Instalar app',
    navGenerator: 'Gerador', navEditor: 'Editor', navOnline: 'Online',
    convertFrom: 'Converter de', convertTo: 'Converter para',
    navCharts: 'Charts', navCharacters: 'Personagens', navStages: 'Stages', navModFolder: 'Pasta do Mod', navWeeks: 'Weeks',
    navEditorChart: 'Editor de Chart', navEditorCharacter: 'Editor de Personagem', navEditorStage: 'Editor de Stage', navEditorWeek: 'Editor de Week',
    introSkip: 'Toque para pular',
    onlineTitle: 'Vitrine da Comunidade',
    onlineDesc: 'Os posts aqui são issues públicas no repositório do projeto no GitHub, marcadas com "showcase" — não tem banco de dados separado, então qualquer um pode ler e qualquer um com conta no GitHub pode postar. Clique em Enviar pra abrir uma issue pré-preenchida no GitHub, preencha, e ela aparece aqui depois de postada.',
    onlineSubmit: 'Envie seu projeto', onlineRefresh: 'Atualizar', onlineLoading: 'Carregando projetos…', onlineLoadMore: 'Carregar mais',
    onlineSearchPlaceholder: 'Buscar projetos…', onlineSortNewest: 'Mais recentes', onlineSortOldest: 'Mais antigos', onlineSortReactions: 'Mais curtidos', onlineSortComments: 'Mais comentados',
    optionsAccount: 'Conta (opcional)', optionsGoogleUnconfigured: 'O login com Google ainda não foi configurado neste site.', optionsSignOut: 'Sair',
    optionsProfile: 'Seu perfil', optionsProfileDesc: 'Opcional — só um nome de exibição pra esse navegador, guardado localmente. Nunca é enviado pra lugar nenhum sozinho.',
    optionsProfileNamePlaceholder: 'Nome de exibição', optionsProfileVisible: 'Mostrar meu nome quando eu enviar um projeto pro Online',
    optionsProfileVisibleOnHint: 'Seu nome é adicionado ao envio pré-preenchido — você ainda posta manualmente, nada é automático.',
    optionsProfileVisibleOffHint: 'Seus envios vão usar um modelo genérico, sem nome anexado.'
  }
};

var currentTheme = 'dark';
try {
  var storedTheme = localStorage.getItem('vstuffTheme');
  if (storedTheme === 'light' || storedTheme === 'dark') currentTheme = storedTheme;
} catch (err) {}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  document.getElementById('themeSunBtn').classList.toggle('active', currentTheme === 'light');
  document.getElementById('themeMoonBtn').classList.toggle('active', currentTheme === 'dark');
  var themeMeta = document.getElementById('themeColorMeta');
  if (themeMeta) themeMeta.setAttribute('content', currentTheme === 'light' ? '#f6f5fb' : '#0e0d15');
}

function setTheme(theme) {
  currentTheme = theme;
  try { localStorage.setItem('vstuffTheme', currentTheme); } catch (err) {}
  applyTheme();
}

document.getElementById('themeSunBtn').addEventListener('click', function () { setTheme('light'); });
document.getElementById('themeMoonBtn').addEventListener('click', function () { setTheme('dark'); });

applyTheme();

WebSound.load('click', 'ui/sounds/scrollMenu.ogg');
WebSound.setMuted(localStorage.getItem('vstuffUiSoundMuted') === 'true');
document.getElementById('uiSoundToggle').checked = !WebSound.isMuted();

document.getElementById('uiSoundToggle').addEventListener('change', function () {
  WebSound.setMuted(!this.checked);
  try { localStorage.setItem('vstuffUiSoundMuted', WebSound.isMuted() ? 'true' : 'false'); } catch (err) {}
});

document.addEventListener('click', function (ev) {
  if (ev.target.closest && ev.target.closest('button, .online-card, input[type="checkbox"], input[type="radio"]')) {
    WebSound.play('click', { overlap: true });
  }
});

document.addEventListener('change', function (ev) {
  if (ev.target.tagName === 'SELECT') WebSound.play('click', { overlap: true });
});

function loadProfile() {
  var name = '';
  var visible = true;
  try {
    name = localStorage.getItem('vstuffProfileName') || '';
    var storedVisible = localStorage.getItem('vstuffProfileVisible');
    if (storedVisible !== null) visible = storedVisible === 'true';
  } catch (err) {}
  document.getElementById('profileNameInput').value = name;
  document.getElementById('profileVisibleCheckbox').checked = visible;
  updateProfileVisibleHint();
}

function saveProfileName() {
  try { localStorage.setItem('vstuffProfileName', document.getElementById('profileNameInput').value.trim()); } catch (err) {}
}

function saveProfileVisible() {
  try { localStorage.setItem('vstuffProfileVisible', document.getElementById('profileVisibleCheckbox').checked ? 'true' : 'false'); } catch (err) {}
  updateProfileVisibleHint();
}

function updateProfileVisibleHint() {
  var dict = I18N[currentLang] || I18N.en;
  var visible = document.getElementById('profileVisibleCheckbox').checked;
  document.getElementById('profileVisibleHint').textContent = visible ? dict.optionsProfileVisibleOnHint : dict.optionsProfileVisibleOffHint;
}

document.getElementById('profileNameInput').addEventListener('input', saveProfileName);
document.getElementById('profileVisibleCheckbox').addEventListener('change', saveProfileVisible);

loadProfile();

var currentLang = 'en';
try {
  var storedLang = localStorage.getItem('vstuffLang');
  if (storedLang && I18N[storedLang]) currentLang = storedLang;
} catch (err) {}

function applyTranslations() {
  var dict = I18N[currentLang] || I18N.en;
  var nodes = document.querySelectorAll('[data-i18n]');
  for (var i = 0; i < nodes.length; i++) {
    var key = nodes[i].getAttribute('data-i18n');
    if (dict[key] !== undefined) nodes[i].textContent = dict[key];
  }
  var placeholderNodes = document.querySelectorAll('[data-i18n-placeholder]');
  for (var j = 0; j < placeholderNodes.length; j++) {
    var pKey = placeholderNodes[j].getAttribute('data-i18n-placeholder');
    if (dict[pKey] !== undefined) placeholderNodes[j].placeholder = dict[pKey];
  }
  document.documentElement.lang = currentLang;
  if (document.getElementById('profileVisibleHint')) updateProfileVisibleHint();
}

document.getElementById('optionsGearBtn').addEventListener('click', function (ev) {
  ev.stopPropagation();
  var panel = document.getElementById('optionsPanel');
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
});

document.addEventListener('click', function (ev) {
  var panel = document.getElementById('optionsPanel');
  if (panel.style.display === 'none') return;
  if (ev.target === panel || panel.contains(ev.target) || ev.target === document.getElementById('optionsGearBtn')) return;
  panel.style.display = 'none';
});

var langRadios = document.querySelectorAll('input[name="lang"]');
for (var lr = 0; lr < langRadios.length; lr++) {
  langRadios[lr].checked = langRadios[lr].value === currentLang;
  langRadios[lr].addEventListener('change', function () {
    if (!this.checked) return;
    currentLang = this.value;
    try { localStorage.setItem('vstuffLang', currentLang); } catch (err) {}
    applyTranslations();
  });
}

applyTranslations();

function safeJsonParse(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (firstErr) {
    var cleaned = text.replace(/,(\s*[\]}])/g, '$1');
    if (cleaned !== text) {
      try {
        return JSON.parse(cleaned);
      } catch (secondErr) {
        throw describeJsonError(secondErr, cleaned);
      }
    }
    throw describeJsonError(firstErr, text);
  }
}

function describeJsonError(err, text) {
  var msg = err.message;
  var posMatch = msg.match(/position (\d+)/);
  if (!posMatch) return err;
  var pos = parseInt(posMatch[1], 10);
  var before = text.slice(0, pos);
  var line = (before.match(/\n/g) || []).length + 1;
  var col = pos - before.lastIndexOf('\n');
  return new Error(msg + ' — line ' + line + ', column ' + col);
}

function toNumber(value, fallback) {
  var n = parseFloat(value);
  return isNaN(n) ? fallback : n;
}

function parseSparrowXML(xmlText) {
  var parser = new DOMParser();
  var doc = parser.parseFromString(xmlText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('invalid XML');
  var subs = doc.getElementsByTagName('SubTexture');
  var frames = [];

  function readNum(el, attr, fallback) {
    var raw = el.getAttribute(attr);
    if (raw === null || raw === undefined || raw === '') return fallback;
    var n = parseFloat(raw);
    return isNaN(n) ? fallback : n;
  }

  for (var i = 0; i < subs.length; i++) {
    var el = subs[i];
    var name = el.getAttribute('name') || ('frame' + i);
    var x = readNum(el, 'x', 0);
    var y = readNum(el, 'y', 0);
    var width = readNum(el, 'width', 0);
    var height = readNum(el, 'height', 0);
    var frameX = readNum(el, 'frameX', 0);
    var frameY = readNum(el, 'frameY', 0);
    var frameWidth = readNum(el, 'frameWidth', width);
    var frameHeight = readNum(el, 'frameHeight', height);
    frames.push({ name: name.replace(/\.[a-zA-Z0-9]+$/, ''), x: x, y: y, width: width, height: height, frameX: frameX, frameY: frameY, frameWidth: frameWidth, frameHeight: frameHeight });
  }
  return frames;
}

function parseTexturePackerJSON(jsonText) {
  var data = JSON.parse(jsonText);
  var framesRaw = data.frames;
  if (!framesRaw) throw new Error('no "frames" key found');
  var entries = Array.isArray(framesRaw)
    ? framesRaw
    : Object.keys(framesRaw).map(function (n) { var e = framesRaw[n]; e.filename = e.filename || n; return e; });
  return entries.map(function (e) {
    var name = (e.filename || '').replace(/\.[a-zA-Z0-9]+$/, '');
    var f = e.frame || { x: 0, y: 0, w: 0, h: 0 };
    var sss = e.spriteSourceSize || { x: 0, y: 0, w: f.w, h: f.h };
    var ss = e.sourceSize || { w: f.w, h: f.h };
    return {
      name: name, x: f.x || 0, y: f.y || 0, width: f.w || 0, height: f.h || 0,
      frameX: -(sss.x || 0), frameY: -(sss.y || 0), frameWidth: ss.w || f.w, frameHeight: ss.h || f.h
    };
  });
}

function groupFramesByPrefix(frames) {
  var groups = {};
  frames.forEach(function (f) {
    var m = f.name.match(/^(.*?)(\d+)$/);
    var prefix = m ? m[1] : f.name;
    var num = m ? parseInt(m[2], 10) : 0;
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push({ frame: f, num: num });
  });
  var result = {};
  Object.keys(groups).forEach(function (p) {
    groups[p].sort(function (a, b) { return a.num - b.num; });
    result[p] = groups[p].map(function (g) { return g.frame; });
  });
  return result;
}

var charEditorImage = new Image();
var charEditorFrames = [];
var charEditorGroups = {};
var charEditorCurrentPrefix = null;
var charEditorCurrentFrameIdx = 0;
var charEditorPlaying = false;
var charEditorLastFrameTime = 0;
var charEditorFPS = 24;

function setCharEditorStatus(text, kind) {
  var el = document.getElementById('charEditorStatus');
  el.textContent = text;
  el.className = kind || '';
}

function setCharEditorLoading(loading) {
  var el = document.getElementById('charEditorLoading');
  if (el) el.style.display = loading ? '' : 'none';
}

function renderCharEditorFrame() {
  var canvas = document.getElementById('charEditorCanvas');
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  var hasImage = charEditorImage.complete && !!charEditorImage.naturalWidth;
  var frames = charEditorCurrentPrefix ? charEditorGroups[charEditorCurrentPrefix] : null;
  var hasFrames = frames && frames.length;

  if (!hasImage && !hasFrames) {
    document.getElementById('charEditorFrameInfo').textContent = 'No spritesheet or atlas loaded yet.';
    return;
  }

  if (!hasFrames) {
    var iw = charEditorImage.naturalWidth, ih = charEditorImage.naturalHeight;
    var wholeScale = Math.min(canvas.width / iw, canvas.height / ih, 4);
    if (!isFinite(wholeScale) || wholeScale <= 0) wholeScale = 1;
    var wOffsetX = (canvas.width - iw * wholeScale) / 2;
    var wOffsetY = (canvas.height - ih * wholeScale) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(charEditorImage, 0, 0, iw, ih, wOffsetX, wOffsetY, iw * wholeScale, ih * wholeScale);
    document.getElementById('charEditorFrameInfo').textContent = 'Whole spritesheet (upload an atlas to see individual frames).';
    return;
  }

  if (!hasImage) {
    document.getElementById('charEditorFrameInfo').textContent = charEditorCurrentPrefix + ' — ' + frames.length + ' frame(s) found (upload the PNG to preview them).';
    return;
  }

  charEditorCurrentFrameIdx = ((charEditorCurrentFrameIdx % frames.length) + frames.length) % frames.length;
  var f = frames[charEditorCurrentFrameIdx];
  var scale = Math.min(canvas.width / f.frameWidth, canvas.height / f.frameHeight, 4);
  if (!isFinite(scale) || scale <= 0) scale = 1;
  var offsetX = (canvas.width - f.frameWidth * scale) / 2;
  var offsetY = (canvas.height - f.frameHeight * scale) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    charEditorImage,
    f.x, f.y, f.width, f.height,
    offsetX + (-f.frameX) * scale, offsetY + (-f.frameY) * scale, f.width * scale, f.height * scale
  );
  document.getElementById('charEditorFrameInfo').textContent = charEditorCurrentPrefix + ' — frame ' + (charEditorCurrentFrameIdx + 1) + '/' + frames.length + ' (' + f.name + ')';
}

function charEditorTick(timestamp) {
  if (!charEditorPlaying) return;
  if (!charEditorLastFrameTime) charEditorLastFrameTime = timestamp;
  var interval = 1000 / Math.max(1, charEditorFPS);
  if (timestamp - charEditorLastFrameTime >= interval) {
    charEditorCurrentFrameIdx++;
    charEditorLastFrameTime = timestamp;
    renderCharEditorFrame();
  }
  requestAnimationFrame(charEditorTick);
}

document.getElementById('charEditorPngBtn').addEventListener('click', function () {
  document.getElementById('charEditorPngInput').click();
});
document.getElementById('charEditorPngInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('charEditorPngLabel').textContent = file.name;
  setCharEditorLoading(true);
  charEditorImage = new Image();
  charEditorImage.onload = function () { setCharEditorLoading(false); renderCharEditorFrame(); };
  charEditorImage.onerror = function () { setCharEditorLoading(false); setCharEditorStatus('Could not load that image.', 'err'); };
  charEditorImage.src = URL.createObjectURL(file);
});

document.getElementById('charEditorAtlasBtn').addEventListener('click', function () {
  document.getElementById('charEditorAtlasInput').click();
});
document.getElementById('charEditorAtlasInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('charEditorAtlasLabel').textContent = file.name;
  setCharEditorLoading(true);
  var reader = new FileReader();
  reader.onload = function (ev) {
    var text = ev.target.result;
    try {
      var isXml = /^\s*</.test(text) || /\.xml$/i.test(file.name);
      charEditorFrames = isXml ? parseSparrowXML(text) : parseTexturePackerJSON(text);
      charEditorGroups = groupFramesByPrefix(charEditorFrames);
      var prefixes = Object.keys(charEditorGroups);
      var select = document.getElementById('charEditorPrefixSelect');
      select.innerHTML = '';
      prefixes.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p + ' (' + charEditorGroups[p].length + ')';
        select.appendChild(opt);
      });
      charEditorCurrentPrefix = prefixes[0] || null;
      charEditorCurrentFrameIdx = 0;
      if (charEditorCurrentPrefix) select.value = charEditorCurrentPrefix;
      renderCharEditorFrame();
      setCharEditorStatus('Found ' + prefixes.length + ' animation(s), ' + charEditorFrames.length + ' frame(s) total.', 'ok');
    } catch (err) {
      setCharEditorStatus('Could not parse atlas: ' + err.message, 'err');
    }
    setCharEditorLoading(false);
  };
  reader.onerror = function () { setCharEditorLoading(false); setCharEditorStatus('Could not read that file.', 'err'); };
  reader.readAsText(file);
});

document.getElementById('charEditorPrefixSelect').addEventListener('change', function () {
  charEditorCurrentPrefix = this.value;
  charEditorCurrentFrameIdx = 0;
  renderCharEditorFrame();
});

document.getElementById('charEditorFps').addEventListener('input', function () {
  charEditorFPS = toNumber(this.value, 24);
});

document.getElementById('charEditorPrevBtn').addEventListener('click', function () {
  if (!charEditorCurrentPrefix) return;
  charEditorCurrentFrameIdx--;
  renderCharEditorFrame();
});
document.getElementById('charEditorNextBtn').addEventListener('click', function () {
  if (!charEditorCurrentPrefix) return;
  charEditorCurrentFrameIdx++;
  renderCharEditorFrame();
});

document.getElementById('charEditorPlayBtn').addEventListener('click', function () {
  charEditorPlaying = !charEditorPlaying;
  this.textContent = charEditorPlaying ? 'Pause' : 'Play';
  if (charEditorPlaying) {
    charEditorLastFrameTime = 0;
    requestAnimationFrame(charEditorTick);
  }
});

document.getElementById('charEditorInsertAnimsBtn').addEventListener('click', function () {
  var raw = document.getElementById('charEditorJsonInput').value.trim();
  var obj;
  try {
    obj = raw ? safeJsonParse(raw) : { version: '1.0.0', name: '', renderType: 'multianimateatlas', assetPath: '', scale: 1, singTime: 4, flipX: false, offsets: [0, 0], cameraOffsets: [0, 0], animations: [] };
  } catch (err) {
    setCharEditorStatus('Current JSON doesn\'t parse, fix it first: ' + err.message, 'err');
    return;
  }
  if (!Array.isArray(obj.animations)) obj.animations = [];
  var existingPrefixes = obj.animations.map(function (a) { return a.prefix; });
  var added = 0;
  Object.keys(charEditorGroups).forEach(function (p) {
    if (existingPrefixes.indexOf(p) === -1) {
      obj.animations.push({ name: p, prefix: p, frameRate: 24 });
      added++;
    }
  });
  document.getElementById('charEditorJsonInput').value = JSON.stringify(obj, null, 2);
  setCharEditorStatus('Added ' + added + ' new animation(s) from the atlas.', added ? 'ok' : '');
});

function setupCanvasBgToggle(wrapId, buttonIds) {
  var wrap = document.getElementById(wrapId);
  buttonIds.forEach(function (btnId) {
    var btn = document.getElementById(btnId);
    btn.addEventListener('click', function () {
      buttonIds.forEach(function (otherId) { document.getElementById(otherId).classList.remove('active'); });
      btn.classList.add('active');
      wrap.classList.remove('canvas-bg-dark', 'canvas-bg-light');
      var bg = btn.getAttribute('data-bg');
      if (bg === 'dark') wrap.classList.add('canvas-bg-dark');
      else if (bg === 'light') wrap.classList.add('canvas-bg-light');
    });
  });
}

setupCanvasBgToggle('charEditorCanvasWrap', ['charEditorBgChecker', 'charEditorBgDark', 'charEditorBgLight']);
setupCanvasBgToggle('stageEditorCanvasWrap', ['stageEditorBgChecker', 'stageEditorBgDark', 'stageEditorBgLight']);

document.getElementById('charEditorCopyBtn').addEventListener('click', function () {
  var text = document.getElementById('charEditorJsonInput').value;
  if (!text) return;
  var temp = document.createElement('textarea');
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  setCharEditorStatus('Copied to clipboard.', 'ok');
});

document.getElementById('charEditorDownloadBtn').addEventListener('click', function () {
  var text = document.getElementById('charEditorJsonInput').value;
  if (!text) return;
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'character.json';
  a.click();
  URL.revokeObjectURL(url);
});

var stageEditorImage = new Image();
var stageEditorFrames = [];
var stageEditorGroups = {};
var stageEditorCurrentPrefix = null;
var stageEditorCurrentFrameIdx = 0;
var stageEditorPlaying = false;
var stageEditorLastFrameTime = 0;
var stageEditorFPS = 24;

function setStageEditorStatus(text, kind) {
  var el = document.getElementById('stageEditorStatus');
  el.textContent = text;
  el.className = kind || '';
}

function setStageEditorLoading(loading) {
  var el = document.getElementById('stageEditorLoading');
  if (el) el.style.display = loading ? '' : 'none';
}

function renderStageEditorFrame() {
  var canvas = document.getElementById('stageEditorCanvas');
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  var hasImage = stageEditorImage.complete && !!stageEditorImage.naturalWidth;
  var frames = stageEditorCurrentPrefix ? stageEditorGroups[stageEditorCurrentPrefix] : null;
  var hasFrames = frames && frames.length;

  if (!hasImage && !hasFrames) {
    document.getElementById('stageEditorFrameInfo').textContent = 'No spritesheet or atlas loaded yet.';
    return;
  }

  if (!hasFrames) {
    var iw = stageEditorImage.naturalWidth, ih = stageEditorImage.naturalHeight;
    var wholeScale = Math.min(canvas.width / iw, canvas.height / ih, 4);
    if (!isFinite(wholeScale) || wholeScale <= 0) wholeScale = 1;
    var wOffsetX = (canvas.width - iw * wholeScale) / 2;
    var wOffsetY = (canvas.height - ih * wholeScale) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(stageEditorImage, 0, 0, iw, ih, wOffsetX, wOffsetY, iw * wholeScale, ih * wholeScale);
    document.getElementById('stageEditorFrameInfo').textContent = 'Whole spritesheet (upload an atlas to see individual frames).';
    return;
  }

  if (!hasImage) {
    document.getElementById('stageEditorFrameInfo').textContent = stageEditorCurrentPrefix + ' — ' + frames.length + ' frame(s) found (upload the PNG to preview them).';
    return;
  }

  stageEditorCurrentFrameIdx = ((stageEditorCurrentFrameIdx % frames.length) + frames.length) % frames.length;
  var f = frames[stageEditorCurrentFrameIdx];
  var scale = Math.min(canvas.width / f.frameWidth, canvas.height / f.frameHeight, 4);
  if (!isFinite(scale) || scale <= 0) scale = 1;
  var offsetX = (canvas.width - f.frameWidth * scale) / 2;
  var offsetY = (canvas.height - f.frameHeight * scale) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    stageEditorImage,
    f.x, f.y, f.width, f.height,
    offsetX + (-f.frameX) * scale, offsetY + (-f.frameY) * scale, f.width * scale, f.height * scale
  );
  document.getElementById('stageEditorFrameInfo').textContent = stageEditorCurrentPrefix + ' — frame ' + (stageEditorCurrentFrameIdx + 1) + '/' + frames.length + ' (' + f.name + ')';
}

function stageEditorTick(timestamp) {
  if (!stageEditorPlaying) return;
  if (!stageEditorLastFrameTime) stageEditorLastFrameTime = timestamp;
  var interval = 1000 / Math.max(1, stageEditorFPS);
  if (timestamp - stageEditorLastFrameTime >= interval) {
    stageEditorCurrentFrameIdx++;
    stageEditorLastFrameTime = timestamp;
    renderStageEditorFrame();
  }
  requestAnimationFrame(stageEditorTick);
}

document.getElementById('stageEditorPngBtn').addEventListener('click', function () {
  document.getElementById('stageEditorPngInput').click();
});
document.getElementById('stageEditorPngInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('stageEditorPngLabel').textContent = file.name;
  setStageEditorLoading(true);
  stageEditorImage = new Image();
  stageEditorImage.onload = function () { setStageEditorLoading(false); renderStageEditorFrame(); };
  stageEditorImage.onerror = function () { setStageEditorLoading(false); setStageEditorStatus('Could not load that image.', 'err'); };
  stageEditorImage.src = URL.createObjectURL(file);
});

document.getElementById('stageEditorAtlasBtn').addEventListener('click', function () {
  document.getElementById('stageEditorAtlasInput').click();
});
document.getElementById('stageEditorAtlasInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('stageEditorAtlasLabel').textContent = file.name;
  setStageEditorLoading(true);
  var reader = new FileReader();
  reader.onload = function (ev) {
    var text = ev.target.result;
    try {
      var isXml = /^\s*</.test(text) || /\.xml$/i.test(file.name);
      stageEditorFrames = isXml ? parseSparrowXML(text) : parseTexturePackerJSON(text);
      stageEditorGroups = groupFramesByPrefix(stageEditorFrames);
      var prefixes = Object.keys(stageEditorGroups);
      var select = document.getElementById('stageEditorPrefixSelect');
      select.innerHTML = '';
      prefixes.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p + ' (' + stageEditorGroups[p].length + ')';
        select.appendChild(opt);
      });
      stageEditorCurrentPrefix = prefixes[0] || null;
      stageEditorCurrentFrameIdx = 0;
      if (stageEditorCurrentPrefix) select.value = stageEditorCurrentPrefix;
      renderStageEditorFrame();
      setStageEditorStatus('Found ' + prefixes.length + ' animation(s), ' + stageEditorFrames.length + ' frame(s) total.', 'ok');
    } catch (err) {
      setStageEditorStatus('Could not parse atlas: ' + err.message, 'err');
    }
    setStageEditorLoading(false);
  };
  reader.onerror = function () { setStageEditorLoading(false); setStageEditorStatus('Could not read that file.', 'err'); };
  reader.readAsText(file);
});

document.getElementById('stageEditorPrefixSelect').addEventListener('change', function () {
  stageEditorCurrentPrefix = this.value;
  stageEditorCurrentFrameIdx = 0;
  renderStageEditorFrame();
});

document.getElementById('stageEditorFps').addEventListener('input', function () {
  stageEditorFPS = toNumber(this.value, 24);
});

document.getElementById('stageEditorPrevBtn').addEventListener('click', function () {
  if (!stageEditorCurrentPrefix) return;
  stageEditorCurrentFrameIdx--;
  renderStageEditorFrame();
});
document.getElementById('stageEditorNextBtn').addEventListener('click', function () {
  if (!stageEditorCurrentPrefix) return;
  stageEditorCurrentFrameIdx++;
  renderStageEditorFrame();
});

document.getElementById('stageEditorPlayBtn').addEventListener('click', function () {
  stageEditorPlaying = !stageEditorPlaying;
  this.textContent = stageEditorPlaying ? 'Pause' : 'Play';
  if (stageEditorPlaying) {
    stageEditorLastFrameTime = 0;
    requestAnimationFrame(stageEditorTick);
  }
});

document.getElementById('stageEditorInsertAnimsBtn').addEventListener('click', function () {
  var raw = document.getElementById('stageEditorJsonInput').value.trim();
  var obj;
  try {
    obj = raw ? safeJsonParse(raw) : { version: '1.0.0', name: '', props: [], characters: {}, cameraZoom: 1, directory: 'shared' };
  } catch (err) {
    setStageEditorStatus('Current JSON doesn\'t parse, fix it first: ' + err.message, 'err');
    return;
  }
  if (!Array.isArray(obj.props)) obj.props = [];

  var propName = document.getElementById('stageEditorPropName').value.trim();
  if (!propName) {
    setStageEditorStatus('Give the prop a name first.', 'err');
    return;
  }

  var prop = obj.props.find(function (p) { return p.name === propName; });
  var isNewProp = !prop;
  if (!prop) {
    var assetPath = document.getElementById('stageEditorAssetPath').value.trim();
    prop = { name: propName, assetPath: assetPath || propName, position: [0, 0], animations: [] };
    obj.props.push(prop);
  }
  if (!Array.isArray(prop.animations)) prop.animations = [];

  var existingPrefixes = prop.animations.map(function (a) { return a.prefix; });
  var added = 0;
  Object.keys(stageEditorGroups).forEach(function (p) {
    if (existingPrefixes.indexOf(p) === -1) {
      prop.animations.push({ name: p, prefix: p, frameRate: 24 });
      added++;
    }
  });

  document.getElementById('stageEditorJsonInput').value = JSON.stringify(obj, null, 2);

  if (added) {
    setStageEditorStatus('Added ' + added + ' new animation(s) to prop "' + propName + '".', 'ok');
  } else if (isNewProp) {
    setStageEditorStatus('Created prop "' + propName + '" (no atlas loaded, so no animations yet — upload one and hit this again whenever you\'re ready).', 'ok');
  } else if (!Object.keys(stageEditorGroups).length) {
    setStageEditorStatus('Prop "' + propName + '" already exists. No atlas loaded, so nothing to add — upload one first.', '');
  } else {
    setStageEditorStatus('Prop "' + propName + '" already has all of this atlas\'s animations.', '');
  }
});

document.getElementById('stageEditorCopyBtn').addEventListener('click', function () {
  var text = document.getElementById('stageEditorJsonInput').value;
  if (!text) return;
  var temp = document.createElement('textarea');
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  setStageEditorStatus('Copied to clipboard.', 'ok');
});

document.getElementById('stageEditorDownloadBtn').addEventListener('click', function () {
  var text = document.getElementById('stageEditorJsonInput').value;
  if (!text) return;
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'stage.json';
  a.click();
  URL.revokeObjectURL(url);
});

var weekEdSongs = [];

function setWeekEdStatus(text, kind) {
  var el = document.getElementById('weekEdStatus');
  el.textContent = text;
  el.className = kind || '';
}

function renderWeekEdSongList() {
  var wrap = document.getElementById('weekEdSongList');
  wrap.innerHTML = '';
  weekEdSongs.forEach(function (song, i) {
    var chip = document.createElement('div');
    chip.className = 'week-song-chip';
    var label = document.createElement('span');
    label.textContent = song;
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'week-song-chip-remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', function () {
      weekEdSongs.splice(i, 1);
      renderWeekEdSongList();
      regenerateWeekEdOutput();
    });
    chip.appendChild(label);
    chip.appendChild(removeBtn);
    wrap.appendChild(chip);
  });
}

function regenerateWeekEdOutput() {
  var name = document.getElementById('weekEdName').value.trim() || 'Week';
  var titleAsset = document.getElementById('weekEdTitleAsset').value.trim() || ('storymenu/titles/' + weekSlug(name));
  var background = document.getElementById('weekEdBackground').value.trim() || '#000000';
  var visible = document.getElementById('weekEdVisible').value === 'true';

  var level = {
    version: '1.0.0',
    name: name,
    titleAsset: titleAsset,
    visible: visible,
    props: [],
    background: background,
    songs: weekEdSongs.slice()
  };

  document.getElementById('weekEdOutput').value = JSON.stringify(level, null, 2);
}

['weekEdName', 'weekEdTitleAsset', 'weekEdBackground'].forEach(function (id) {
  document.getElementById(id).addEventListener('input', regenerateWeekEdOutput);
});
document.getElementById('weekEdVisible').addEventListener('change', regenerateWeekEdOutput);

function addWeekEdSong() {
  var input = document.getElementById('weekEdSongInput');
  var value = input.value.trim().toLowerCase();
  if (!value) return;
  if (weekEdSongs.indexOf(value) !== -1) {
    setWeekEdStatus('"' + value + '" is already in the list.', 'err');
    return;
  }
  weekEdSongs.push(value);
  input.value = '';
  renderWeekEdSongList();
  regenerateWeekEdOutput();
  setWeekEdStatus('');
}

document.getElementById('weekEdAddSongBtn').addEventListener('click', addWeekEdSong);
document.getElementById('weekEdSongInput').addEventListener('keydown', function (ev) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    addWeekEdSong();
  }
});

document.getElementById('weekEdFileBtn').addEventListener('click', function () {
  document.getElementById('weekEdFileInput').click();
});
document.getElementById('weekEdFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('weekEdFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) { document.getElementById('weekEdOutput').value = ev.target.result; };
  reader.onerror = function () { setWeekEdStatus('Could not read that file.', 'err'); };
  reader.readAsText(file);
});

document.getElementById('weekEdLoadBtn').addEventListener('click', function () {
  var raw = document.getElementById('weekEdOutput').value.trim();
  if (!raw) {
    setWeekEdStatus('Upload a level.json first, or paste one into the output box below, then hit Load.', 'err');
    return;
  }
  try {
    var parsed = safeJsonParse(raw);
    document.getElementById('weekEdName').value = parsed.name || '';
    document.getElementById('weekEdTitleAsset').value = parsed.titleAsset || '';
    document.getElementById('weekEdBackground').value = parsed.background || '';
    document.getElementById('weekEdVisible').value = parsed.visible === false ? 'false' : 'true';
    weekEdSongs = Array.isArray(parsed.songs) ? parsed.songs.slice() : [];
    renderWeekEdSongList();
    regenerateWeekEdOutput();
    setWeekEdStatus('Loaded ' + weekEdSongs.length + ' song(s).', 'ok');
  } catch (err) {
    setWeekEdStatus('Could not load: ' + err.message, 'err');
  }
});

document.getElementById('weekEdCopyBtn').addEventListener('click', function () {
  var text = document.getElementById('weekEdOutput').value;
  if (!text) return;
  var temp = document.createElement('textarea');
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  setWeekEdStatus('Copied to clipboard.', 'ok');
});

document.getElementById('weekEdDownloadBtn').addEventListener('click', function () {
  var text = document.getElementById('weekEdOutput').value;
  if (!text) return;
  var name = weekFilenameFromName(document.getElementById('weekEdName').value.trim() || 'Week');
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

regenerateWeekEdOutput();

function parseCodenameXmlDoc(xmlText, rootTagCheck) {
  var parser = new DOMParser();
  var doc = parser.parseFromString(xmlText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('invalid XML');
  var rootEl = doc.getElementsByTagName(rootTagCheck)[0];
  if (!rootEl) throw new Error('no <' + rootTagCheck + '> element found');
  return rootEl;
}

function readCodenameAnimEls(animEls) {
  var animations = [];
  var startingAnimation = null;
  var hasDeath = false;
  for (var i = 0; i < animEls.length; i++) {
    var el = animEls[i];
    var name = el.getAttribute('name') || ('anim' + i);
    var prefix = el.getAttribute('anim') || name;
    var outAnim = { name: name, prefix: prefix };

    var ax = parseFloat(el.getAttribute('x'));
    var ay = parseFloat(el.getAttribute('y'));
    outAnim.offsets = [isNaN(ax) ? 0 : ax, isNaN(ay) ? 0 : ay];

    var fps = parseFloat(el.getAttribute('fps'));
    if (!isNaN(fps)) outAnim.frameRate = fps;
    if (el.getAttribute('loop') === 'true') outAnim.looped = true;

    if (isDeathAnimId(name)) {
      hasDeath = true;
      outAnim.name = classifyDeathAnim(name);
    }
    if (startingAnimation === null) startingAnimation = outAnim.name;
    animations.push(outAnim);
  }
  return { animations: animations, startingAnimation: startingAnimation, hasDeath: hasDeath };
}

function convertCodenameCharacter(xmlText, meta) {
  meta = meta || {};
  var charEl = parseCodenameXmlDoc(xmlText, 'character');

  var offsetX = parseFloat(charEl.getAttribute('x')) || 0;
  var offsetY = parseFloat(charEl.getAttribute('y')) || 0;
  var spriteName = charEl.getAttribute('sprite') || '';
  var flipX = charEl.getAttribute('flipX') === 'true';
  var icon = charEl.getAttribute('icon') || '';

  var animResult = readCodenameAnimEls(charEl.getElementsByTagName('anim'));

  var camX = meta.cameraOffsetX !== undefined && meta.cameraOffsetX !== null ? meta.cameraOffsetX : 0;
  var camY = meta.cameraOffsetY !== undefined && meta.cameraOffsetY !== null ? meta.cameraOffsetY : 0;

  var out = {
    version: '1.0.0',
    name: meta.name || guessDisplayName(spriteName),
    renderType: meta.renderType || 'multianimateatlas',
    assetPath: meta.assetPath || ('shared:characters/' + spriteName.toLowerCase()),
    scale: 1,
    singTime: 4,
    startingAnimation: animResult.startingAnimation,
    flipX: flipX,
    offsets: [offsetX, offsetY],
    cameraOffsets: [camX, camY],
    animations: animResult.animations
  };
  if (icon) out.healthIcon = { id: icon };
  if (animResult.hasDeath) out.death = { cameraOffsets: [camX, camY] };

  return out;
}

function convertCodenameStage(xmlText, meta) {
  meta = meta || {};
  var stageEl = parseCodenameXmlDoc(xmlText, 'stage');

  var zoom = parseFloat(stageEl.getAttribute('zoom'));
  var folder = stageEl.getAttribute('folder') || '';

  var props = [];
  var charZ = {};
  var zCounter = 10;

  var children = stageEl.childNodes;
  for (var i = 0; i < children.length; i++) {
    var node = children[i];
    if (node.nodeType !== 1) continue;
    var tag = node.tagName.toLowerCase();

    if (tag === 'sprite') {
      var name = node.getAttribute('name') || ('prop' + props.length);
      var spriteName = node.getAttribute('sprite') || name;
      var x = parseFloat(node.getAttribute('x')) || 0;
      var y = parseFloat(node.getAttribute('y')) || 0;
      var scroll = parseFloat(node.getAttribute('scroll'));
      if (isNaN(scroll)) scroll = 1;

      var animResult = readCodenameAnimEls(node.getElementsByTagName('anim'));

      var prop = {
        name: name,
        assetPath: folder + spriteName,
        position: [x, y],
        scroll: [scroll, scroll],
        zIndex: zCounter,
        animations: animResult.animations
      };
      if (animResult.startingAnimation) prop.startingAnimation = animResult.startingAnimation;
      props.push(prop);
      zCounter += 10;
    } else if (tag === 'girlfriend' || tag === 'gf') {
      charZ.gf = zCounter; zCounter += 10;
    } else if (tag === 'dad' || tag === 'opponent') {
      charZ.dad = zCounter; zCounter += 10;
    } else if (tag === 'boyfriend' || tag === 'bf') {
      charZ.bf = zCounter; zCounter += 10;
    }
  }

  var gfEntry = { position: [0, 0], cameraOffsets: [0, 0], zIndex: charZ.gf !== undefined ? charZ.gf : 100 };
  if (charZ.gf === undefined) gfEntry.alpha = 0;

  var characters = {
    bf: { position: [0, 0], cameraOffsets: [0, 0], zIndex: charZ.bf !== undefined ? charZ.bf : 300 },
    dad: { position: [0, 0], cameraOffsets: [0, 0], zIndex: charZ.dad !== undefined ? charZ.dad : 200 },
    gf: gfEntry
  };

  return {
    version: '1.0.2',
    name: meta.name || stageEl.getAttribute('name') || 'stage',
    props: props,
    characters: characters,
    cameraZoom: isNaN(zoom) ? 1 : zoom,
    directory: 'shared'
  };
}

function hexToRgbArray(hex) {
  if (!hex) return null;
  var m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function convertCodenameToPsychCharacter(xmlText, meta) {
  meta = meta || {};
  var charEl = parseCodenameXmlDoc(xmlText, 'character');

  var offsetX = parseFloat(charEl.getAttribute('x')) || 0;
  var offsetY = parseFloat(charEl.getAttribute('y')) || 0;
  var spriteName = charEl.getAttribute('sprite') || '';
  var flipX = charEl.getAttribute('flipX') === 'true';
  var icon = charEl.getAttribute('icon') || '';
  var isPlayer = charEl.getAttribute('isPlayer') === 'true';
  var colorHex = charEl.getAttribute('color') || '';

  var animEls = charEl.getElementsByTagName('anim');
  var psychAnims = [];
  for (var i = 0; i < animEls.length; i++) {
    var el = animEls[i];
    var ax = parseFloat(el.getAttribute('x'));
    var ay = parseFloat(el.getAttribute('y'));
    var fps = parseFloat(el.getAttribute('fps'));
    psychAnims.push({
      loop: el.getAttribute('loop') === 'true',
      offsets: [isNaN(ax) ? 0 : ax, isNaN(ay) ? 0 : ay],
      anim: el.getAttribute('name') || ('anim' + i),
      fps: isNaN(fps) ? (meta.fps !== undefined ? meta.fps : 24) : fps,
      name: el.getAttribute('anim') || el.getAttribute('name') || ('anim' + i),
      indices: []
    });
  }

  var hb = hexToRgbArray(colorHex) || (meta.hbColor || [0, 0, 0]);

  return {
    animations: psychAnims,
    vocals_file: '',
    no_antialiasing: false,
    image: meta.image || ('characters/' + spriteName),
    position: [meta.posX !== undefined ? meta.posX : offsetX, meta.posY !== undefined ? meta.posY : offsetY],
    healthicon: meta.healthicon || icon,
    flip_x: flipX,
    healthbar_colors: hb,
    sing_duration: meta.singDuration !== undefined ? meta.singDuration : 4,
    scale: meta.scale !== undefined ? meta.scale : 1,
    _editor_isPlayer: isPlayer
  };
}

function convertCodenameToPsychStage(xmlText, meta) {
  meta = meta || {};
  var stageEl = parseCodenameXmlDoc(xmlText, 'stage');

  var zoom = parseFloat(stageEl.getAttribute('zoom'));
  var folder = stageEl.getAttribute('folder') || '';

  var props = [];
  var charZ = {};
  var zCounter = 10;

  var children = stageEl.childNodes;
  for (var i = 0; i < children.length; i++) {
    var node = children[i];
    if (node.nodeType !== 1) continue;
    var tag = node.tagName.toLowerCase();

    if (tag === 'sprite') {
      var name = node.getAttribute('name') || ('prop' + props.length);
      var spriteName = node.getAttribute('sprite') || name;
      var x = parseFloat(node.getAttribute('x')) || 0;
      var y = parseFloat(node.getAttribute('y')) || 0;
      var scroll = parseFloat(node.getAttribute('scroll'));
      if (isNaN(scroll)) scroll = 1;

      var animResult = readCodenameAnimEls(node.getElementsByTagName('anim'));

      var prop = {
        name: name,
        assetPath: folder + spriteName,
        position: [x, y],
        scroll: [scroll, scroll],
        zIndex: zCounter,
        animations: animResult.animations
      };
      if (animResult.startingAnimation) prop.startingAnimation = animResult.startingAnimation;
      props.push(prop);
      zCounter += 10;
    } else if (tag === 'girlfriend' || tag === 'gf') {
      charZ.gf = zCounter; zCounter += 10;
    } else if (tag === 'dad' || tag === 'opponent') {
      charZ.dad = zCounter; zCounter += 10;
    } else if (tag === 'boyfriend' || tag === 'bf') {
      charZ.bf = zCounter; zCounter += 10;
    }
  }

  var maxCharZ = Math.max(charZ.bf || 0, charZ.dad || 0, charZ.gf || 0);
  var isPixel = meta.isPixel === 'true' ? true : (meta.isPixel === 'false' ? false : guessIsPixelFromProps(props));
  var gfHidden = charZ.gf === undefined;

  var out = {
    directory: 'shared',
    defaultZoom: isNaN(zoom) ? 1 : zoom,
    isPixelStage: isPixel,
    boyfriend: [0, 0],
    girlfriend: [0, 0],
    opponent: [0, 0],
    hide_girlfriend: gfHidden,
    camera_boyfriend: [0, 0],
    camera_opponent: [0, 0],
    camera_girlfriend: [0, 0],
    camera_speed: meta.cameraSpeed !== undefined ? meta.cameraSpeed : 1
  };

  var luaResult = buildLuaFromProps(props, maxCharZ);

  return { stage: out, lua: luaResult.text, scaleWarnings: luaResult.scaleWarnings, nonSparrowWarnings: luaResult.nonSparrowWarnings, propCount: props.length };
}

function convertPsychCharacter(psychJson, meta) {
  var anims = psychJson.animations || [];
  var outAnims = [];
  var hasDeath = false;
  var startingAnimation = null;

  for (var i = 0; i < anims.length; i++) {
    var a = anims[i];
    var outAnim = { name: a.anim, prefix: a.name };

    if (a.loop) outAnim.looped = true;
    if (Array.isArray(a.offsets)) outAnim.offsets = a.offsets;
    if (typeof a.fps === 'number') outAnim.frameRate = a.fps;
    if (Array.isArray(a.indices) && a.indices.length) outAnim.frameIndices = a.indices;

    if (isDeathAnimId(a.anim)) {
      hasDeath = true;
      outAnim.name = classifyDeathAnim(a.anim);
    }

    if (startingAnimation === null) startingAnimation = outAnim.name;
    outAnims.push(outAnim);
  }

  var camX = meta.cameraOffsetX !== undefined && meta.cameraOffsetX !== null ? meta.cameraOffsetX : 0;
  var camY = meta.cameraOffsetY !== undefined && meta.cameraOffsetY !== null ? meta.cameraOffsetY : 0;

  var out = {
    version: '1.0.0',
    name: meta.name || guessDisplayName(psychJson.image),
    renderType: meta.renderType || 'multianimateatlas',
    assetPath: meta.assetPath || guessAssetPath(psychJson.image),
    scale: psychJson.scale !== undefined ? psychJson.scale : 1,
    singTime: psychJson.sing_duration !== undefined ? psychJson.sing_duration : 4,
    startingAnimation: startingAnimation,
    flipX: !!psychJson.flip_x,
    offsets: [meta.offsetX || 0, meta.offsetY || 0],
    cameraOffsets: [camX, camY],
    animations: outAnims
  };

  if (psychJson.healthicon) out.healthIcon = { id: psychJson.healthicon };

  if (hasDeath) {
    out.death = {
      cameraOffsets: [
        meta.deathCameraOffsetX !== undefined && meta.deathCameraOffsetX !== null ? meta.deathCameraOffsetX : camX,
        meta.deathCameraOffsetY !== undefined && meta.deathCameraOffsetY !== null ? meta.deathCameraOffsetY : camY
      ]
    };
  }

  return out;
}

function setCharStatus(text, kind) {
  var el = document.getElementById('charStatus');
  el.textContent = text;
  el.className = kind || '';
}

function readCharMetaFields() {
  return {
    name: document.getElementById('charName').value.trim(),
    renderType: document.getElementById('charRenderType').value,
    assetPath: document.getElementById('charAssetPath').value.trim(),
    offsetX: toNumber(document.getElementById('charOffsetX').value, 0),
    offsetY: toNumber(document.getElementById('charOffsetY').value, 0),
    cameraOffsetX: document.getElementById('charCamOffsetX').value.trim() === '' ? null : toNumber(document.getElementById('charCamOffsetX').value, 0),
    cameraOffsetY: document.getElementById('charCamOffsetY').value.trim() === '' ? null : toNumber(document.getElementById('charCamOffsetY').value, 0),
    deathCameraOffsetX: document.getElementById('charDeathCamOffsetX').value.trim() === '' ? null : toNumber(document.getElementById('charDeathCamOffsetX').value, 0),
    deathCameraOffsetY: document.getElementById('charDeathCamOffsetY').value.trim() === '' ? null : toNumber(document.getElementById('charDeathCamOffsetY').value, 0)
  };
}

function renderCharOutput() {
  var wrap = document.getElementById('charOutputWrap');
  var actions = document.getElementById('charOutputActions');

  if (!lastCharResult) {
    wrap.innerHTML = '<div class="empty-state">Convert a character to see the output here.</div>';
    actions.style.display = 'none';
    return;
  }

  wrap.innerHTML = '<textarea id="charOutputArea" readonly spellcheck="false" style="width:100%;height:480px;"></textarea>';
  document.getElementById('charOutputArea').value = JSON.stringify(lastCharResult, null, 2);
  actions.style.display = 'flex';
}

document.getElementById('charFileBtn').addEventListener('click', function () {
  document.getElementById('charFileInput').click();
});

document.getElementById('charFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('charFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) {
    document.getElementById('charInput').value = ev.target.result;
    trySuggestCharFields();
  };
  reader.readAsText(file);
});

document.getElementById('charInput').addEventListener('blur', trySuggestCharFields);

function trySuggestCharFields() {
  var raw = document.getElementById('charInput').value.trim();
  if (!raw) return;
  try {
    var parsed = safeJsonParse(raw);
    var nameField = document.getElementById('charName');
    var assetField = document.getElementById('charAssetPath');
    if (!nameField.value && parsed.image) nameField.value = guessDisplayName(parsed.image);
    if (!assetField.value && parsed.image) assetField.value = guessAssetPath(parsed.image);
  } catch (err) {
    return;
  }
}

document.getElementById('charConvertBtn').addEventListener('click', function () {
  var raw = document.getElementById('charInput').value.trim();
  if (!raw) {
    setCharStatus('Paste or upload a Psych character first.', 'err');
    return;
  }

  var parsed;
  try {
    parsed = safeJsonParse(raw);
  } catch (err) {
    setCharStatus('That JSON doesn\'t parse: ' + err.message, 'err');
    return;
  }

  try {
    var meta = readCharMetaFields();
    lastCharResult = convertPsychCharacter(parsed, meta);
    var animCount = lastCharResult.animations.length;
    var deathNote = lastCharResult.death ? ', death animation detected' : '';
    setCharStatus('Converted ' + animCount + ' animations' + deathNote + '.', 'ok');
    renderCharOutput();
  } catch (err) {
    setCharStatus('Conversion failed: ' + err.message, 'err');
  }
});

document.getElementById('charCopyBtn').addEventListener('click', function () {
  var area = document.getElementById('charOutputArea');
  if (!area) return;
  area.select();
  document.execCommand('copy');
  setCharStatus('Copied character.json to clipboard.', 'ok');
});

document.getElementById('charDownloadBtn').addEventListener('click', function () {
  if (!lastCharResult) return;
  var name = (readCharMetaFields().name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  var blob = new Blob([JSON.stringify(lastCharResult, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name + '-character.json';
  a.click();
  URL.revokeObjectURL(url);
});

var lastStageResult = null;

function extractLuaProps(luaSource, isPixelDefault) {
  var props = {};
  var order = [];
  var bgCounter = 10;
  var fgCounter = 310;
  var conditionalNames = {};
  var blendNames = {};

  function ensureProp(name) {
    if (!props[name]) {
      props[name] = {
        danceEvery: 0,
        zIndex: null,
        position: [0, 0],
        scale: [1, 1],
        animType: 'sparrow',
        name: name,
        isPixel: isPixelDefault,
        assetPath: '',
        atlasSettings: null,
        scroll: [1, 1],
        startingAnimation: null,
        animations: []
      };
      order.push(name);
    }
    return props[name];
  }

  var condRegex = /if\s+lowQuality\s*==\s*false\s+then([\s\S]*?)\n\s*end/g;
  var condMatch;
  while ((condMatch = condRegex.exec(luaSource))) {
    var block = condMatch[1];
    var nameRegex = /make(?:Animated)?LuaSprite\('([^']+)'/g;
    var nm;
    while ((nm = nameRegex.exec(block))) conditionalNames[nm[1]] = true;
  }

  var makeRegex = /make(Animated)?LuaSprite\('([^']+)',\s*'([^']*)',\s*(-?[\d.]+),\s*(-?[\d.]+)\)/g;
  var m;
  while ((m = makeRegex.exec(luaSource))) {
    var prop = ensureProp(m[2]);
    prop.assetPath = m[3];
    prop.position = [parseFloat(m[4]), parseFloat(m[5])];
  }

  var animRegex = /addAnimationByPrefix\('([^']+)',\s*'([^']*)',\s*'([^']*)',\s*(\d+)(?:,\s*(true|false))?\)/g;
  var am;
  while ((am = animRegex.exec(luaSource))) {
    var prop2 = ensureProp(am[1]);
    var animEntry = { name: am[2], prefix: am[3], frameRate: parseInt(am[4], 10), flipX: false, flipY: false };
    if (am[5] === 'true') animEntry.looped = true;
    prop2.animations.push(animEntry);
    if (prop2.startingAnimation === null) prop2.startingAnimation = am[2];
  }

  var indicesAnimRegex = /addAnimationByIndices\('([^']+)',\s*'([^']*)',\s*'([^']*)',\s*\{([^}]*)\},\s*(\d+)(?:,\s*(true|false))?\)/g;
  var iam;
  while ((iam = indicesAnimRegex.exec(luaSource))) {
    var prop2b = ensureProp(iam[1]);
    var indicesList = iam[4].split(',').map(function (s) { return parseInt(s.trim(), 10); }).filter(function (n) { return !isNaN(n); });
    var animEntry2 = { name: iam[2], prefix: iam[3], frameRate: parseInt(iam[5], 10), flipX: false, flipY: false, frameIndices: indicesList };
    if (iam[6] === 'true') animEntry2.looped = true;
    prop2b.animations.push(animEntry2);
    if (prop2b.startingAnimation === null) prop2b.startingAnimation = iam[2];
  }

  var scrollRegex = /setScrollFactor\('([^']+)',\s*(-?[\d.]+),\s*(-?[\d.]+)\)/g;
  var sm;
  while ((sm = scrollRegex.exec(luaSource))) {
    ensureProp(sm[1]).scroll = [parseFloat(sm[2]), parseFloat(sm[3])];
  }

  var blendRegex = /setBlendMode\('([^']+)',\s*'([^']*)'\)/g;
  var bm;
  while ((bm = blendRegex.exec(luaSource))) {
    blendNames[bm[1]] = bm[2];
  }

  var copyPairs = [];
  var orderCopyRegex = /setObjectOrder\('([^']+)',\s*getObjectOrder\('([^']+)'\)\)/g;
  var oc;
  while ((oc = orderCopyRegex.exec(luaSource))) {
    copyPairs.push([oc[1], oc[2]]);
  }

  var addRegex = /addLuaSprite\('([^']+)'(?:,\s*(true))?\)/g;
  var addm;
  while ((addm = addRegex.exec(luaSource))) {
    var prop3 = ensureProp(addm[1]);
    var foreground = addm[2] === 'true';
    if (prop3.zIndex === null) {
      prop3.zIndex = foreground ? fgCounter : bgCounter;
      if (foreground) fgCounter += 10; else bgCounter += 10;
    }
  }

  for (var i = 0; i < copyPairs.length; i++) {
    var a = copyPairs[i][0], b = copyPairs[i][1];
    if (props[a] && props[b] && props[b].zIndex !== null) {
      props[a].zIndex = props[b].zIndex;
    }
  }

  var propsArray = [];
  for (var j = 0; j < order.length; j++) {
    var p = props[order[j]];
    if (p.zIndex === null) {
      p.zIndex = bgCounter;
      bgCounter += 10;
    }
    propsArray.push(p);
  }

  return {
    props: propsArray,
    conditionalNames: Object.keys(conditionalNames),
    blendNames: blendNames
  };
}

function convertPsychStage(stageJson, luaSource, meta) {
  var isPixelDefault = meta.isPixel === 'true' ? true : (meta.isPixel === 'false' ? false : !!stageJson.isPixelStage);
  var extraction = luaSource ? extractLuaProps(luaSource, isPixelDefault) : { props: [], conditionalNames: [], blendNames: {} };

  var characters = {};
  if (Array.isArray(stageJson.boyfriend)) {
    characters.bf = {
      zIndex: meta.bfZ,
      position: stageJson.boyfriend,
      cameraOffsets: stageJson.camera_boyfriend || [0, 0]
    };
  }
  if (Array.isArray(stageJson.opponent)) {
    characters.dad = {
      zIndex: meta.dadZ,
      position: stageJson.opponent,
      cameraOffsets: stageJson.camera_opponent || [0, 0]
    };
  }
  if (!stageJson.hide_girlfriend && Array.isArray(stageJson.girlfriend)) {
    characters.gf = {
      zIndex: meta.gfZ,
      position: stageJson.girlfriend,
      cameraOffsets: stageJson.camera_girlfriend || [0, 0]
    };
  }

  var out = {
    props: extraction.props,
    cameraZoom: stageJson.defaultZoom !== undefined ? stageJson.defaultZoom : 1,
    version: '1.0.0',
    characters: characters,
    name: meta.name || guessDisplayName(stageJson.directory),
    directory: stageJson.directory || ''
  };

  return { stage: out, conditionalNames: extraction.conditionalNames, blendNames: extraction.blendNames };
}

function setStageStatus(text, kind) {
  var el = document.getElementById('stageStatus');
  el.textContent = text;
  el.className = kind || '';
}

function readStageMetaFields() {
  return {
    name: document.getElementById('stageName').value.trim(),
    isPixel: document.getElementById('stageIsPixel').value,
    bfZ: toNumber(document.getElementById('stageBfZ').value, 300),
    dadZ: toNumber(document.getElementById('stageDadZ').value, 200),
    gfZ: toNumber(document.getElementById('stageGfZ').value, 100)
  };
}

function renderStageOutput() {
  var wrap = document.getElementById('stageOutputWrap');
  var actions = document.getElementById('stageOutputActions');

  if (!lastStageResult) {
    wrap.innerHTML = '<div class="empty-state">Convert a stage to see the output here.</div>';
    actions.style.display = 'none';
    document.getElementById('stageDynamicNotes').innerHTML = '';
    return;
  }

  wrap.innerHTML = '<textarea id="stageOutputArea" readonly spellcheck="false" style="width:100%;height:480px;"></textarea>';
  document.getElementById('stageOutputArea').value = JSON.stringify(lastStageResult.stage, null, 2);
  actions.style.display = 'flex';

  var notesHtml = '';
  if (lastStageResult.conditionalNames.length) {
    notesHtml += '<div class="notes-info"><strong>Behind a lowQuality check in the Lua</strong> — ' + lastStageResult.conditionalNames.join(', ') + '. They were still extracted; decide in your engine whether to keep them unconditional or gate them again.</div>';
  }
  var blendKeys = Object.keys(lastStageResult.blendNames);
  if (blendKeys.length) {
    var blendList = blendKeys.map(function (k) { return k + ' = ' + lastStageResult.blendNames[k]; }).join(', ');
    notesHtml += '<div class="notes-info"><strong>Blend modes found (not in this schema)</strong> — ' + blendList + '.</div>';
  }
  document.getElementById('stageDynamicNotes').innerHTML = notesHtml;
}

document.getElementById('stageFileBtn').addEventListener('click', function () {
  document.getElementById('stageFileInput').click();
});

document.getElementById('stageFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('stageFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) {
    document.getElementById('stageInput').value = ev.target.result;
    trySuggestStageFields();
  };
  reader.readAsText(file);
});

document.getElementById('luaFileBtn').addEventListener('click', function () {
  document.getElementById('luaFileInput').click();
});

document.getElementById('luaFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('luaFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) {
    document.getElementById('luaInput').value = ev.target.result;
  };
  reader.readAsText(file);
});

document.getElementById('stageInput').addEventListener('blur', trySuggestStageFields);

function trySuggestStageFields() {
  var raw = document.getElementById('stageInput').value.trim();
  if (!raw) return;
  try {
    var parsed = safeJsonParse(raw);
    var nameField = document.getElementById('stageName');
    if (!nameField.value && parsed.directory) nameField.value = guessDisplayName(parsed.directory);
  } catch (err) {
    return;
  }
}

document.getElementById('stageConvertBtn').addEventListener('click', function () {
  var raw = document.getElementById('stageInput').value.trim();
  if (!raw) {
    setStageStatus('Paste or upload a Psych stage JSON first.', 'err');
    return;
  }

  var parsed;
  try {
    parsed = safeJsonParse(raw);
  } catch (err) {
    setStageStatus('That JSON doesn\'t parse: ' + err.message, 'err');
    return;
  }

  try {
    var meta = readStageMetaFields();
    var luaSource = document.getElementById('luaInput').value.trim();
    lastStageResult = convertPsychStage(parsed, luaSource, meta);
    var propCount = lastStageResult.stage.props.length;
    var charCount = Object.keys(lastStageResult.stage.characters).length;
    setStageStatus('Converted ' + charCount + ' characters and ' + propCount + ' props.', 'ok');
    renderStageOutput();
  } catch (err) {
    setStageStatus('Conversion failed: ' + err.message, 'err');
  }
});

document.getElementById('stageCopyBtn').addEventListener('click', function () {
  var area = document.getElementById('stageOutputArea');
  if (!area) return;
  area.select();
  document.execCommand('copy');
  setStageStatus('Copied stage.json to clipboard.', 'ok');
});

document.getElementById('stageDownloadBtn').addEventListener('click', function () {
  if (!lastStageResult) return;
  var name = (readStageMetaFields().name || 'stage').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  var blob = new Blob([JSON.stringify(lastStageResult.stage, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name + '-stage.json';
  a.click();
  URL.revokeObjectURL(url);
});

function roundTimeR(t) {
  return Math.round(t * 1000) / 1000;
}

function findSectionIndex(sections, t) {
  for (var i = 0; i < sections.length; i++) {
    if (t >= sections[i].startTime - 0.5 && t < sections[i].endTime - 0.5) return i;
  }
  return sections.length - 1;
}

function buildSectionsFromTimeChanges(timeChanges, notes) {
  var tc = (timeChanges && timeChanges.length ? timeChanges : [{ t: 0, b: 0, bpm: 100 }]).slice().sort(function (a, b) { return a.t - b.t; });
  var sections = [];
  var segIndex = 0;
  var currentTime = tc[0].t;
  var lastNoteTime = notes.length ? notes[notes.length - 1].t : currentTime;
  var previousBpm = null;

  while (currentTime <= lastNoteTime + 1 || sections.length === 0) {
    while (segIndex + 1 < tc.length && tc[segIndex + 1].t <= currentTime + 0.5) segIndex++;
    var currentBpm = tc[segIndex].bpm;
    var msPerBeat = 60000 / currentBpm;
    var sectionDuration = 4 * msPerBeat;
    var sectionEnd = currentTime + sectionDuration;
    var changeBPM = previousBpm !== null && currentBpm !== previousBpm;

    sections.push({ startTime: currentTime, endTime: sectionEnd, bpm: currentBpm, changeBPM: changeBPM });
    previousBpm = currentBpm;
    currentTime = sectionEnd;

    if (sections.length > 4000) break;
  }

  for (var s = 0; s < sections.length; s++) sections[s].notes = [];
  for (var i = 0; i < notes.length; i++) {
    var idx = findSectionIndex(sections, notes[i].t);
    if (idx < 0) idx = sections.length - 1;
    sections[idx].notes.push(notes[i]);
  }

  return sections.map(function (sec) {
    var playerCount = 0, oppCount = 0;
    sec.notes.forEach(function (n) { if (n.d < 4) playerCount++; else oppCount++; });
    var mustHit = playerCount >= oppCount;

    var sectionNotes = sec.notes.map(function (n) {
      var noteData = mustHit ? n.d : (n.d + 4) % 8;
      var tuple = [roundTimeR(n.t), noteData, n.l || 0];
      if (n.k) tuple.push(n.k);
      return tuple;
    });

    return {
      sectionBeats: 4,
      sectionNotes: sectionNotes,
      gfSection: false,
      altAnim: false,
      mustHitSection: mustHit,
      changeBPM: !!sec.changeBPM,
      bpm: sec.bpm
    };
  });
}

function vSliceTargetToPsychName(target) {
  if (!target) return 'boyfriend';
  var lower = String(target).toLowerCase();
  if (lower === 'opponent' || lower === 'dad') return 'dad';
  if (lower === 'girlfriend' || lower === 'gf') return 'gf';
  return 'boyfriend';
}

function vSliceCharIndexToPsychName(index) {
  if (index === 0) return 'dad';
  if (index === 2) return 'gf';
  return 'boyfriend';
}

function mapVSliceEventToPsych(ev, zoomTrackers) {
  if (ev.e === 'PlayAnimation') {
    return ['Play Animation', ev.v.anim || '', vSliceTargetToPsychName(ev.v.target)];
  }
  if (ev.e === 'ZoomCamera') {
    var key = ev.v.mode || 'stage';
    var prev = zoomTrackers[key] !== undefined ? zoomTrackers[key] : 1;
    var newZoom = ev.v.zoom !== undefined ? ev.v.zoom : prev;
    var amount = newZoom - prev;
    zoomTrackers[key] = newZoom;
    var p2 = key === 'stage' ? '' : key;
    return ['Add Camera Zoom', String(Math.round(amount * 1000) / 1000), p2];
  }
  if (ev.e === 'FlashCamera') {
    var duration = ev.v.duration !== undefined ? ev.v.duration : 0.5;
    var target = ev.v.target === 'camGame' ? '' : (ev.v.target || '');
    return ['Flash Camera', String(duration), target];
  }
  if (ev.e === 'FocusCamera') {
    var charName = ev.v.char !== undefined ? vSliceCharIndexToPsychName(ev.v.char) : 'boyfriend';
    var rest = {};
    for (var k in ev.v) { if (k !== 'char') rest[k] = ev.v[k]; }
    return ['FocusCamera', charName, JSON.stringify(rest)];
  }
  if (ev.e === 'ScrollSpeed') {
    var strumline = ev.v.strumline && ev.v.strumline !== 'both' ? ev.v.strumline : '';
    var scrollValue = ev.v.scroll !== undefined ? ev.v.scroll : 1;
    return ['Change Scroll Speed', String(scrollValue), strumline];
  }
  if (ev.e === 'SwitchIdleSuffix') {
    var idleCharName = ev.v.target !== undefined ? vSliceCharIndexToPsychName(ev.v.target) : 'boyfriend';
    return ['SwitchIdleSuffix', idleCharName, ev.v.suffix || ''];
  }
  if (ev.v && (ev.v.p1 !== undefined || ev.v.p2 !== undefined)) {
    return [ev.e, ev.v.p1 !== undefined ? ev.v.p1 : '', ev.v.p2 !== undefined ? ev.v.p2 : ''];
  }
  if (ev.v && Object.keys(ev.v).length) {
    return [ev.e, '', JSON.stringify(ev.v)];
  }
  return [ev.e, '', ''];
}

function convertVSliceEvents(events) {
  var byTime = {};
  var order = [];
  var zoomTrackers = {};

  (events || []).forEach(function (ev) {
    var tuple = mapVSliceEventToPsych(ev, zoomTrackers);
    if (!tuple) return;
    var t = ev.t;
    if (!byTime[t]) { byTime[t] = []; order.push(t); }
    byTime[t].push(tuple);
  });

  order.sort(function (a, b) { return a - b; });
  return order.map(function (t) { return [t, byTime[t]]; });
}

function convertVSliceToPsychChart(chartJson, metaJson, opts) {
  var diff = opts.difficulty || 'normal';
  var notes = (chartJson.notes && chartJson.notes[diff]) || [];
  var timeChanges = metaJson && metaJson.timeChanges ? metaJson.timeChanges : [{ t: 0, b: 0, bpm: 100 }];
  var speed = (chartJson.scrollSpeed && chartJson.scrollSpeed[diff] !== undefined) ? chartJson.scrollSpeed[diff] : 1;

  var sections = buildSectionsFromTimeChanges(timeChanges, notes);
  var eventsOut = convertVSliceEvents(chartJson.events || []);

  var characters = (metaJson && metaJson.playData && metaJson.playData.characters) || {};

  var songOut = {
    player1: characters.player || 'bf',
    gfVersion: characters.girlfriend || 'gf',
    notes: sections,
    events: eventsOut,
    player2: characters.opponent || 'dad',
    disableNoteRGB: true,
    song: (metaJson && metaJson.songName) || 'Song',
    stage: (metaJson && metaJson.playData && metaJson.playData.stage) || 'stage',
    needsVoices: opts.needsVoices !== false,
    speed: speed,
    bpm: timeChanges.length ? timeChanges[0].bpm : 100
  };

  return { song: songOut };
}

var lastChartRResult = null;

function setChartRStatus(text, kind) {
  var el = document.getElementById('chartRStatus');
  el.textContent = text;
  el.className = kind || '';
}

function renderChartROutput() {
  var wrap = document.getElementById('chartROutputWrap');
  var actions = document.getElementById('chartROutputActions');
  if (!lastChartRResult) {
    wrap.innerHTML = '<div class="empty-state">Convert a chart to see the output here.</div>';
    actions.style.display = 'none';
    return;
  }
  wrap.innerHTML = '<textarea id="chartROutputArea" readonly spellcheck="false" style="width:100%;height:480px;"></textarea>';
  document.getElementById('chartROutputArea').value = JSON.stringify(lastChartRResult, null, 2);
  actions.style.display = 'flex';
}

document.getElementById('chartRFileBtn').addEventListener('click', function () { document.getElementById('chartRFileInput').click(); });
document.getElementById('chartRFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('chartRFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) {
    document.getElementById('chartRInput').value = ev.target.result;
    trySuggestChartRDifficulty();
  };
  reader.readAsText(file);
});
document.getElementById('chartRInput').addEventListener('blur', trySuggestChartRDifficulty);

function trySuggestChartRDifficulty() {
  var raw = document.getElementById('chartRInput').value.trim();
  if (!raw) return;
  try {
    var parsed = safeJsonParse(raw);
    var notes = parsed.notes || {};
    var order = ['normal', 'hard', 'easy'];
    var best = order.find(function (d) { return notes[d] && notes[d].length; });
    if (best) document.getElementById('chartRDifficulty').value = best;
  } catch (err) {
    return;
  }
}

document.getElementById('metaRFileBtn').addEventListener('click', function () { document.getElementById('metaRFileInput').click(); });
document.getElementById('metaRFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('metaRFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) { document.getElementById('metaRInput').value = ev.target.result; };
  reader.readAsText(file);
});

document.getElementById('chartRConvertBtn').addEventListener('click', function () {
  var rawChart = document.getElementById('chartRInput').value.trim();
  if (!rawChart) {
    setChartRStatus('Paste or upload a V-Slice chart first.', 'err');
    return;
  }
  var chartJson, metaJson;
  try {
    chartJson = JSON.parse(rawChart);
  } catch (err) {
    setChartRStatus('Chart JSON doesn\'t parse: ' + err.message, 'err');
    return;
  }
  var rawMeta = document.getElementById('metaRInput').value.trim();
  if (rawMeta) {
    try {
      metaJson = JSON.parse(rawMeta);
    } catch (err) {
      setChartRStatus('Metadata JSON doesn\'t parse: ' + err.message, 'err');
      return;
    }
  }

  try {
    var opts = {
      difficulty: document.getElementById('chartRDifficulty').value,
      needsVoices: document.getElementById('chartRNeedsVoices').checked
    };
    lastChartRResult = convertVSliceToPsychChart(chartJson, metaJson, opts);
    var sectionCount = lastChartRResult.song.notes.length;
    setChartRStatus('Converted into ' + sectionCount + ' sections.', 'ok');
    renderChartROutput();
  } catch (err) {
    setChartRStatus('Conversion failed: ' + err.message, 'err');
  }
});

document.getElementById('chartRCopyBtn').addEventListener('click', function () {
  var area = document.getElementById('chartROutputArea');
  if (!area) return;
  area.select();
  document.execCommand('copy');
  setChartRStatus('Copied chart.json to clipboard.', 'ok');
});

document.getElementById('chartRDownloadBtn').addEventListener('click', function () {
  if (!lastChartRResult) return;
  var name = (lastChartRResult.song.song || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  var blob = new Blob([JSON.stringify(lastChartRResult, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name + '-chart.json';
  a.click();
  URL.revokeObjectURL(url);
});

function convertVSliceToPsychCharacter(vJson, meta) {
  var anims = vJson.animations || [];
  var outAnims = anims.map(function (a) {
    return {
      loop: !!a.looped,
      offsets: Array.isArray(a.offsets) ? a.offsets : [0, 0],
      anim: a.name,
      fps: a.frameRate !== undefined ? a.frameRate : meta.fps,
      name: a.prefix || a.name,
      indices: Array.isArray(a.frameIndices) ? a.frameIndices : []
    };
  });

  var image = meta.image || (vJson.assetPath || '').replace(/^shared:/, '');
  var hb = meta.hbColor || [0, 0, 0];
  var healthiconValue = (vJson.healthIcon && vJson.healthIcon.id) || meta.healthicon || '';

  return {
    animations: outAnims,
    vocals_file: '',
    no_antialiasing: false,
    image: image,
    position: [meta.posX || 0, meta.posY || 0],
    healthicon: healthiconValue,
    flip_x: !!vJson.flipX,
    healthbar_colors: hb,
    sing_duration: vJson.singTime !== undefined ? vJson.singTime : (meta.singDuration !== undefined ? meta.singDuration : 4),
    scale: vJson.scale !== undefined ? vJson.scale : (meta.scale !== undefined ? meta.scale : 1),
    _editor_isPlayer: false
  };
}

var lastCharRResult = null;

function setCharRStatus(text, kind) {
  var el = document.getElementById('charRStatus');
  el.textContent = text;
  el.className = kind || '';
}

function readCharRMetaFields() {
  var hbRaw = document.getElementById('charRHbColor').value.trim();
  var hb = hbRaw ? hbRaw.split(',').map(function (v) { return toNumber(v, 0); }) : [0, 0, 0];
  return {
    image: document.getElementById('charRImage').value.trim(),
    healthicon: document.getElementById('charRHealthicon').value.trim(),
    scale: toNumber(document.getElementById('charRScale').value, 1),
    singDuration: toNumber(document.getElementById('charRSingDuration').value, 4),
    posX: toNumber(document.getElementById('charRPosX').value, 0),
    posY: toNumber(document.getElementById('charRPosY').value, 0),
    hbColor: hb,
    fps: toNumber(document.getElementById('charRFps').value, 24)
  };
}

function renderCharROutput() {
  var wrap = document.getElementById('charROutputWrap');
  var actions = document.getElementById('charROutputActions');
  if (!lastCharRResult) {
    wrap.innerHTML = '<div class="empty-state">Convert a character to see the output here.</div>';
    actions.style.display = 'none';
    return;
  }
  wrap.innerHTML = '<textarea id="charROutputArea" readonly spellcheck="false" style="width:100%;height:480px;"></textarea>';
  document.getElementById('charROutputArea').value = JSON.stringify(lastCharRResult, null, 2);
  actions.style.display = 'flex';
}

document.getElementById('charRFileBtn').addEventListener('click', function () { document.getElementById('charRFileInput').click(); });
document.getElementById('charRFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('charRFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) {
    document.getElementById('charRInput').value = ev.target.result;
    try {
      var parsed = JSON.parse(ev.target.result);
      var imageField = document.getElementById('charRImage');
      if (!imageField.value && parsed.assetPath) imageField.value = String(parsed.assetPath).replace(/^shared:/, '');
    } catch (err) {}
  };
  reader.readAsText(file);
});

document.getElementById('charRConvertBtn').addEventListener('click', function () {
  var raw = document.getElementById('charRInput').value.trim();
  if (!raw) {
    setCharRStatus('Paste or upload a V-Slice character first.', 'err');
    return;
  }
  var parsed;
  try {
    parsed = safeJsonParse(raw);
  } catch (err) {
    setCharRStatus('That JSON doesn\'t parse: ' + err.message, 'err');
    return;
  }
  try {
    var meta = readCharRMetaFields();
    lastCharRResult = convertVSliceToPsychCharacter(parsed, meta);
    setCharRStatus('Converted ' + lastCharRResult.animations.length + ' animations.', 'ok');
    renderCharROutput();
  } catch (err) {
    setCharRStatus('Conversion failed: ' + err.message, 'err');
  }
});

document.getElementById('charRCopyBtn').addEventListener('click', function () {
  var area = document.getElementById('charROutputArea');
  if (!area) return;
  area.select();
  document.execCommand('copy');
  setCharRStatus('Copied character.json to clipboard.', 'ok');
});

document.getElementById('charRDownloadBtn').addEventListener('click', function () {
  if (!lastCharRResult) return;
  var blob = new Blob([JSON.stringify(lastCharRResult, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'character.json';
  a.click();
  URL.revokeObjectURL(url);
});

function guessIsPixelFromProps(props) {
  if (!props || !props.length) return false;
  return props.every(function (p) { return !!p.isPixel; });
}

function normalizeScale(scale) {
  if (Array.isArray(scale)) return [scale[0], scale.length > 1 ? scale[1] : scale[0]];
  if (typeof scale === 'number') return [scale, scale];
  return [1, 1];
}

function buildLuaFromProps(propsIn, maxCharZ) {
  var props = (propsIn || []).map(function (p, idx) {
    var copy = {};
    for (var k in p) copy[k] = p[k];
    if (copy.zIndex === undefined || copy.zIndex === null) copy.zIndex = idx;
    return copy;
  });
  var sorted = props.slice().sort(function (a, b) { return a.zIndex - b.zIndex; });
  var lines = ['function onCreate()'];
  var scaleWarnings = [];
  var nonSparrowWarnings = [];

  sorted.forEach(function (p) {
    var pos = Array.isArray(p.position) ? p.position : [0, 0];
    var animated = p.animations && p.animations.length;

    if (animated) {
      lines.push("\tmakeAnimatedLuaSprite('" + p.name + "', '" + p.assetPath + "', " + pos[0] + ', ' + pos[1] + ')');
      p.animations.forEach(function (a) {
        var loopArg = a.looped ? ', true' : '';
        var fps = a.frameRate !== undefined ? a.frameRate : 24;
        if (Array.isArray(a.frameIndices) && a.frameIndices.length) {
          var indicesStr = '{' + a.frameIndices.join(', ') + '}';
          lines.push("\taddAnimationByIndices('" + p.name + "', '" + a.name + "', '" + a.prefix + "', " + indicesStr + ', ' + fps + loopArg + ')');
        } else {
          lines.push("\taddAnimationByPrefix('" + p.name + "', '" + a.name + "', '" + a.prefix + "', " + fps + loopArg + ')');
        }
      });
      if (p.startingAnimation) {
        lines.push("\tobjectPlayAnimation('" + p.name + "', '" + p.startingAnimation + "')");
      }
    } else {
      lines.push("\tmakeLuaSprite('" + p.name + "', '" + p.assetPath + "', " + pos[0] + ', ' + pos[1] + ')');
    }

    if (Array.isArray(p.scroll) && (p.scroll[0] !== 1 || p.scroll[1] !== 1)) {
      lines.push("\tsetScrollFactor('" + p.name + "', " + p.scroll[0] + ', ' + p.scroll[1] + ')');
    }

    var scaleXY = normalizeScale(p.scale);
    if (scaleXY[0] !== 1 || scaleXY[1] !== 1) {
      scaleWarnings.push(p.name);
    }

    if (p.animType && p.animType !== 'sparrow') {
      nonSparrowWarnings.push(p.name + ' (' + p.animType + ')');
    }

    var foreground = p.zIndex > maxCharZ;
    lines.push("\taddLuaSprite('" + p.name + "'" + (foreground ? ', true' : '') + ')');
    lines.push('');
  });

  lines.push('end');

  return { text: lines.join('\n'), scaleWarnings: scaleWarnings, nonSparrowWarnings: nonSparrowWarnings };
}

function convertVSliceToPsychStage(stageJson, meta) {
  var chars = stageJson.characters || {};
  var maxCharZ = 0;
  Object.keys(chars).forEach(function (k) {
    if (chars[k].zIndex > maxCharZ) maxCharZ = chars[k].zIndex;
  });

  var isPixel = meta.isPixel === 'true' ? true : (meta.isPixel === 'false' ? false : guessIsPixelFromProps(stageJson.props));
  var gfHidden = !chars.gf || chars.gf.alpha === 0;

  var out = {
    directory: stageJson.directory || '',
    defaultZoom: stageJson.cameraZoom !== undefined ? stageJson.cameraZoom : 1,
    isPixelStage: isPixel,
    boyfriend: chars.bf ? chars.bf.position : [0, 0],
    girlfriend: chars.gf ? chars.gf.position : [0, 0],
    opponent: chars.dad ? chars.dad.position : [0, 0],
    hide_girlfriend: gfHidden,
    camera_boyfriend: chars.bf ? chars.bf.cameraOffsets : [0, 0],
    camera_opponent: chars.dad ? chars.dad.cameraOffsets : [0, 0],
    camera_girlfriend: chars.gf ? chars.gf.cameraOffsets : [0, 0],
    camera_speed: meta.cameraSpeed !== undefined ? meta.cameraSpeed : 1
  };

  var luaResult = buildLuaFromProps(stageJson.props || [], maxCharZ);

  return { stage: out, lua: luaResult.text, scaleWarnings: luaResult.scaleWarnings, nonSparrowWarnings: luaResult.nonSparrowWarnings };
}

var lastStageRResult = null;
var activeStageRTab = 'json';

function setStageRStatus(text, kind) {
  var el = document.getElementById('stageRStatus');
  el.textContent = text;
  el.className = kind || '';
}

function renderStageROutput() {
  var wrap = document.getElementById('stageROutputWrap');
  var actions = document.getElementById('stageROutputActions');

  if (!lastStageRResult) {
    wrap.innerHTML = '<div class="empty-state">Convert a stage to see the output here.</div>';
    actions.style.display = 'none';
    document.getElementById('stageRDynamicNotes').innerHTML = '';
    return;
  }

  wrap.innerHTML = '<textarea id="stageROutputArea" readonly spellcheck="false" style="width:100%;height:420px;"></textarea>';
  var text = activeStageRTab === 'json' ? JSON.stringify(lastStageRResult.stage, null, 2) : lastStageRResult.lua;
  document.getElementById('stageROutputArea').value = text;
  actions.style.display = 'flex';

  var notesHtml = '';
  if (lastStageRResult.scaleWarnings.length) {
    notesHtml += '<div class="notes-info"><strong>Scale not reproduced for</strong> — ' + lastStageRResult.scaleWarnings.join(', ') + '. Add setGraphicSize calls by hand for these.</div>';
  }
  if (lastStageRResult.nonSparrowWarnings.length) {
    notesHtml += '<div class="notes-info"><strong>Non-sparrow props (double check these)</strong> — ' + lastStageRResult.nonSparrowWarnings.join(', ') + '.</div>';
  }
  document.getElementById('stageRDynamicNotes').innerHTML = notesHtml;
}

document.getElementById('tabStageRJson').addEventListener('click', function () {
  activeStageRTab = 'json';
  document.getElementById('tabStageRJson').classList.add('active');
  document.getElementById('tabStageRLua').classList.remove('active');
  renderStageROutput();
});

document.getElementById('tabStageRLua').addEventListener('click', function () {
  activeStageRTab = 'lua';
  document.getElementById('tabStageRLua').classList.add('active');
  document.getElementById('tabStageRJson').classList.remove('active');
  renderStageROutput();
});

document.getElementById('stageRFileBtn').addEventListener('click', function () { document.getElementById('stageRFileInput').click(); });
document.getElementById('stageRFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('stageRFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) { document.getElementById('stageRInput').value = ev.target.result; };
  reader.readAsText(file);
});

document.getElementById('stageRConvertBtn').addEventListener('click', function () {
  var raw = document.getElementById('stageRInput').value.trim();
  if (!raw) {
    setStageRStatus('Paste or upload a V-Slice stage JSON first.', 'err');
    return;
  }
  var parsed;
  try {
    parsed = safeJsonParse(raw);
  } catch (err) {
    setStageRStatus('That JSON doesn\'t parse: ' + err.message, 'err');
    return;
  }
  try {
    var meta = {
      isPixel: document.getElementById('stageRIsPixel').value,
      cameraSpeed: toNumber(document.getElementById('stageRCameraSpeed').value, 1)
    };
    lastStageRResult = convertVSliceToPsychStage(parsed, meta);
    var propCount = (parsed.props || []).length;
    setStageRStatus('Converted ' + propCount + ' props into Lua.', 'ok');
    renderStageROutput();
  } catch (err) {
    setStageRStatus('Conversion failed: ' + err.message, 'err');
  }
});

document.getElementById('stageRCopyBtn').addEventListener('click', function () {
  var area = document.getElementById('stageROutputArea');
  if (!area) return;
  area.select();
  document.execCommand('copy');
  setStageRStatus('Copied ' + (activeStageRTab === 'json' ? 'stage.json' : 'stage.lua') + ' to clipboard.', 'ok');
});

document.getElementById('stageRDownloadBtn').addEventListener('click', function () {
  if (!lastStageRResult) return;
  var name = (lastStageRResult.stage.directory || 'stage').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  var isJson = activeStageRTab === 'json';
  var content = isJson ? JSON.stringify(lastStageRResult.stage, null, 2) : lastStageRResult.lua;
  var filename = isJson ? name + '-stage.json' : name + '-stage.lua';
  var blob = new Blob([content], { type: isJson ? 'application/json' : 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

var APP_TABS = ['navAppGenerator', 'navAppEditor', 'navAppOnline'];
var APP_PAGES = ['generatorApp', 'editorApp', 'onlineApp'];
var onlineLoadedOnce = false;

function showAppTab(index) {
  for (var i = 0; i < APP_TABS.length; i++) {
    document.getElementById(APP_TABS[i]).classList.toggle('active', i === index);
    document.getElementById(APP_PAGES[i]).style.display = i === index ? '' : 'none';
  }
  if (index === 2 && !onlineLoadedOnce) {
    onlineLoadedOnce = true;
    if (typeof loadCommunityProjects === 'function') loadCommunityProjects();
  }
}

document.getElementById('navAppGenerator').addEventListener('click', function () { showAppTab(0); });
document.getElementById('navAppEditor').addEventListener('click', function () { showAppTab(1); });
document.getElementById('navAppOnline').addEventListener('click', function () { showAppTab(2); });

var EDITOR_SUBTABS = ['navEditorChart', 'navEditorCharacter', 'navEditorStage', 'navEditorWeek'];
var EDITOR_SUBPAGES = ['chartEditorSub', 'characterEditorSub', 'stageEditorSub', 'weekEditorSub'];

function showEditorSubtab(index) {
  for (var i = 0; i < EDITOR_SUBTABS.length; i++) {
    document.getElementById(EDITOR_SUBTABS[i]).classList.toggle('active', i === index);
    document.getElementById(EDITOR_SUBPAGES[i]).style.display = i === index ? '' : 'none';
  }
}

document.getElementById('navEditorChart').addEventListener('click', function () { showEditorSubtab(0); });
document.getElementById('navEditorCharacter').addEventListener('click', function () { showEditorSubtab(1); });
document.getElementById('navEditorStage').addEventListener('click', function () { showEditorSubtab(2); });
document.getElementById('navEditorWeek').addEventListener('click', function () { showEditorSubtab(3); });

var editorChart = null;
var editorNotes = [];
var editorBpmValue = 100;
var editorSnapValue = 16;
var editorPxPerBeat = 80;
var editorColWidth = 46;
var editorNumLanes = 8;

function editorMsPerBeat() {
  return 60000 / editorBpmValue;
}

function editorSnapMs() {
  return editorMsPerBeat() * 4 / editorSnapValue;
}

function editorPxPerMs() {
  return editorPxPerBeat / editorMsPerBeat();
}

function editorTimeToY(t) {
  return t * editorPxPerMs();
}

function editorYToTime(y) {
  return y / editorPxPerMs();
}

function editorSnapTime(t) {
  var s = editorSnapMs();
  return Math.round(t / s) * s;
}

function setEditorStatus(text, kind) {
  var el = document.getElementById('editorStatus');
  el.textContent = text;
  el.className = kind || '';
}

document.getElementById('editorChartFileBtn').addEventListener('click', function () {
  document.getElementById('editorChartFileInput').click();
});
document.getElementById('editorChartFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('editorChartFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) { document.getElementById('editorChartInput').value = ev.target.result; };
  reader.readAsText(file);
});

document.getElementById('editorMetaFileBtn').addEventListener('click', function () {
  document.getElementById('editorMetaFileInput').click();
});
document.getElementById('editorMetaFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('editorMetaFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) { document.getElementById('editorMetaInput').value = ev.target.result; };
  reader.readAsText(file);
});

function resolveEditorBpm() {
  var rawMeta = document.getElementById('editorMetaInput').value.trim();
  var bpmField = toNumber(document.getElementById('editorBpm').value, null);
  if (rawMeta) {
    try {
      var parsedMeta = JSON.parse(rawMeta);
      if (parsedMeta.timeChanges && parsedMeta.timeChanges.length) {
        return parsedMeta.timeChanges[0].bpm || 100;
      }
    } catch (err) {
      return bpmField || 100;
    }
  }
  return bpmField || 100;
}

function applyEditorGridSettings() {
  editorBpmValue = resolveEditorBpm();
  editorSnapValue = toNumber(document.getElementById('editorSnap').value, 16);
  editorPxPerBeat = toNumber(document.getElementById('editorZoom').value, 80);
}

document.getElementById('editorNewBtn').addEventListener('click', function () {
  applyEditorGridSettings();

  editorChart = {
    version: '2.0.0',
    scrollSpeed: { easy: 1, normal: 1, hard: 1 },
    events: [],
    notes: { easy: [], normal: [], hard: [] },
    generatedBy: 'V Stuff'
  };

  var diff = document.getElementById('editorDifficulty').value;
  editorNotes = editorChart.notes[diff];

  setEditorStatus('Started a blank chart on ' + diff + ' at ' + editorBpmValue + ' BPM. Drag on the grid to add notes.', 'ok');
  renderEditorGrid();
});

document.getElementById('editorLoadBtn').addEventListener('click', function () {
  var rawChart = document.getElementById('editorChartInput').value.trim();
  if (!rawChart) {
    setEditorStatus('Paste or upload a V-Slice chart first — or use "New chart" to start from scratch.', 'err');
    return;
  }

  var parsedChart;
  try {
    parsedChart = JSON.parse(rawChart);
  } catch (err) {
    setEditorStatus('Chart JSON doesn\'t parse: ' + err.message, 'err');
    return;
  }

  var rawMeta = document.getElementById('editorMetaInput').value.trim();
  if (rawMeta) {
    try {
      JSON.parse(rawMeta);
    } catch (err) {
      setEditorStatus('Metadata JSON doesn\'t parse: ' + err.message, 'err');
      return;
    }
  }

  applyEditorGridSettings();

  editorChart = parsedChart;
  if (!editorChart.notes) editorChart.notes = {};

  var diff = document.getElementById('editorDifficulty').value;
  if (!Array.isArray(editorChart.notes[diff])) editorChart.notes[diff] = [];
  editorNotes = editorChart.notes[diff];

  setEditorStatus('Loaded ' + editorNotes.length + ' notes on ' + diff + ' at ' + editorBpmValue + ' BPM.', 'ok');
  renderEditorGrid();
});

document.getElementById('editorDifficulty').addEventListener('change', function () {
  if (!editorChart) return;
  var diff = document.getElementById('editorDifficulty').value;
  if (!Array.isArray(editorChart.notes[diff])) editorChart.notes[diff] = [];
  editorNotes = editorChart.notes[diff];
  renderEditorGrid();
});

function editorSetZoom(newPxPerBeat) {
  newPxPerBeat = Math.max(20, Math.min(300, newPxPerBeat));
  var wrap = document.getElementById('editorGridWrap');
  var centerBeat = (wrap.scrollTop + wrap.clientHeight / 2) / editorPxPerBeat;
  editorPxPerBeat = newPxPerBeat;
  document.getElementById('editorZoom').value = String(newPxPerBeat);
  if (editorChart) renderEditorGrid();
  wrap.scrollTop = centerBeat * newPxPerBeat - wrap.clientHeight / 2;
}

document.getElementById('editorZoomInBtn').addEventListener('click', function () { editorSetZoom(editorPxPerBeat + 20); });
document.getElementById('editorZoomOutBtn').addEventListener('click', function () { editorSetZoom(editorPxPerBeat - 20); });

function renderEditorGrid() {
  var wrap = document.getElementById('editorGridInner');
  wrap.innerHTML = '';

  var maxTime = 0;
  editorNotes.forEach(function (n) {
    var end = n.t + (n.l || 0);
    if (end > maxTime) maxTime = end;
  });
  var editorEvents = (editorChart && Array.isArray(editorChart.events)) ? editorChart.events : [];
  editorEvents.forEach(function (ev) {
    if (ev.t > maxTime) maxTime = ev.t;
  });
  var audioEl = document.getElementById('editorAudioEl');
  if (audioEl && audioEl.duration) {
    var audioMs = audioEl.duration * 1000;
    if (audioMs > maxTime) maxTime = audioMs;
  }

  var msPerBeat = editorMsPerBeat();
  var totalBeats = Math.ceil(maxTime / msPerBeat) + 16;
  var totalHeight = totalBeats * editorPxPerBeat;
  var totalWidth = editorColWidth * editorNumLanes + (editorEvents.length ? 26 : 0);

  wrap.style.height = totalHeight + 'px';
  wrap.style.width = totalWidth + 'px';

  var laneColors = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
  for (var lane = 0; lane < editorNumLanes; lane++) {
    var laneBg = document.createElement('div');
    laneBg.className = 'editor-lane-bg';
    laneBg.style.left = (lane * editorColWidth) + 'px';
    laneBg.style.width = editorColWidth + 'px';
    if (lane === 3) laneBg.style.borderRightColor = 'var(--text-dim)';
    wrap.appendChild(laneBg);
  }

  for (var beat = 0; beat <= totalBeats; beat++) {
    var line = document.createElement('div');
    var isMeasure = beat % 4 === 0;
    line.className = 'editor-gridline' + (isMeasure ? ' measure' : '');
    line.style.top = (beat * editorPxPerBeat) + 'px';
    wrap.appendChild(line);

    if (isMeasure) {
      var label = document.createElement('div');
      label.className = 'editor-measure-label';
      label.style.top = (beat * editorPxPerBeat + 2) + 'px';
      label.textContent = 'm' + (beat / 4);
      wrap.appendChild(label);
    }
  }

  editorNotes.forEach(function (note) {
    var el = document.createElement('div');
    editorUpdateNoteEl(el, note);
    el.style.width = (editorColWidth - 6) + 'px';
    el.title = 't=' + Math.round(note.t) + ' d=' + note.d + (note.l ? ' l=' + Math.round(note.l) : '') + (note.k ? ' k=' + note.k : '');
    el._note = note;

    var handle = document.createElement('div');
    handle.className = 'editor-note-handle';
    handle._note = note;
    el.appendChild(handle);

    var delBtn = document.createElement('div');
    delBtn.className = 'editor-note-delete';
    delBtn.textContent = '\u00d7';
    delBtn.title = 'Delete note';
    delBtn._note = note;
    el.appendChild(delBtn);

    wrap.appendChild(el);
  });

  var playhead = document.createElement('div');
  playhead.id = 'editorPlayheadLine';
  wrap.appendChild(playhead);

  var eventColX = editorColWidth * editorNumLanes + 8;
  editorEvents.forEach(function (ev) {
    var marker = document.createElement('div');
    marker.className = 'editor-event-marker';
    marker.style.top = (editorTimeToY(ev.t) - 5) + 'px';
    marker.style.left = eventColX + 'px';
    marker.title = ev.e + ' @ ' + Math.round(ev.t) + 'ms';
    wrap.appendChild(marker);
  });

  document.getElementById('editorNoteCount').textContent = editorNotes.length + ' notes' + (editorEvents.length ? ', ' + editorEvents.length + ' events' : '');
  updateEditorPlayhead();
}

function editorUpdateNoteEl(el, note) {
  var laneColors = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
  el.className = 'editor-note ' + (laneColors[note.d] || 'l0');
  el.style.left = (note.d * editorColWidth + 3) + 'px';
  el.style.top = editorTimeToY(note.t) + 'px';
  el.style.height = Math.max(14, editorTimeToY(note.l || 0)) + 'px';
}

function editorClientToLocal(clientX, clientY, wrap) {
  var rect = wrap.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top + wrap.scrollTop
  };
}

function editorLaneFromX(x) {
  return Math.max(0, Math.min(editorNumLanes - 1, Math.floor(x / editorColWidth)));
}

function editorPointFromEvent(ev) {
  if (ev.touches && ev.touches.length) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
  if (ev.changedTouches && ev.changedTouches.length) return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
  return { x: ev.clientX, y: ev.clientY };
}

var editorDrag = null;
var editorUndoStack = [];

function editorPushUndo() {
  editorUndoStack.push(JSON.stringify(editorNotes));
  if (editorUndoStack.length > 50) editorUndoStack.shift();
}

function editorUndo() {
  if (!editorChart || !editorUndoStack.length) return;
  var prev = JSON.parse(editorUndoStack.pop());
  editorNotes.length = 0;
  Array.prototype.push.apply(editorNotes, prev);
  renderEditorGrid();
}

document.getElementById('editorUndoBtn').addEventListener('click', editorUndo);

document.addEventListener('keydown', function (ev) {
  if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'z' || ev.shiftKey) return;
  var active = document.activeElement;
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
  ev.preventDefault();
  editorUndo();
});

var editorTouchPending = null;
var EDITOR_DRAG_PX_THRESHOLD = 5;

function findEditorNoteElement(note) {
  var wrap = document.getElementById('editorGridInner');
  for (var i = 0; i < wrap.children.length; i++) {
    if (wrap.children[i]._note === note) return wrap.children[i];
  }
  return null;
}

function editorDeleteNote(note) {
  var pos = editorNotes.indexOf(note);
  if (pos !== -1) editorNotes.splice(pos, 1);
  renderEditorGrid();
}

function editorApplyDragMove(local) {
  if (!editorDrag) return;
  var dy = local.y - editorDrag.startY;
  var dx = editorDrag.startX !== undefined ? local.x - editorDrag.startX : 0;
  if (Math.abs(dy) > EDITOR_DRAG_PX_THRESHOLD || Math.abs(dx) > EDITOR_DRAG_PX_THRESHOLD) editorDrag.moved = true;

  if (editorDrag.mode === 'create' || editorDrag.mode === 'resize') {
    var newT = editorSnapTime(editorYToTime(local.y));
    editorDrag.note.l = Math.max(0, newT - editorDrag.note.t);
    if (editorDrag.el) editorUpdateNoteEl(editorDrag.el, editorDrag.note);
  } else if (editorDrag.mode === 'move') {
    var deltaT = editorYToTime(local.y) - editorYToTime(editorDrag.startY);
    var newT2 = Math.max(0, editorSnapTime(editorDrag.startT + deltaT));
    var newLane = editorLaneFromX(local.x);
    editorDrag.note.t = newT2;
    editorDrag.note.d = newLane;
    if (editorDrag.el) editorUpdateNoteEl(editorDrag.el, editorDrag.note);
  }
}

function editorFinalizeDrag() {
  if (!editorDrag) return;
  if (editorDrag.mode === 'move' && !editorDrag.moved) {
    var pos = editorNotes.indexOf(editorDrag.note);
    if (pos !== -1) editorNotes.splice(pos, 1);
  }
  editorDrag = null;
  renderEditorGrid();
}

function editorGridStart(clientX, clientY, target) {
  if (!editorChart) return;
  editorPushUndo();
  var wrap = document.getElementById('editorGridInner');
  var local = editorClientToLocal(clientX, clientY, wrap);
  var delBtn = target.classList && target.classList.contains('editor-note-delete') ? target : null;
  var handleEl = !delBtn && target.classList && target.classList.contains('editor-note-handle') ? target : null;
  var noteEl = !delBtn && !handleEl && target.closest ? target.closest('.editor-note') : null;

  if (delBtn) {
    editorDeleteNote(delBtn._note);
    return 'handled';
  }
  if (handleEl) {
    editorDrag = { mode: 'resize', note: handleEl._note, el: handleEl.parentNode, moved: false, startY: local.y };
    return 'drag';
  }
  if (noteEl) {
    editorDrag = { mode: 'move', note: noteEl._note, el: noteEl, moved: false, startX: local.x, startY: local.y, startT: noteEl._note.t };
    return 'drag';
  }
  var lane = editorLaneFromX(local.x);
  var t = Math.max(0, editorSnapTime(editorYToTime(local.y)));
  var newNote = { t: t, d: lane, l: 0, p: [] };
  editorNotes.push(newNote);
  renderEditorGrid();
  editorDrag = { mode: 'create', note: newNote, el: findEditorNoteElement(newNote), moved: false, startY: local.y };
  return 'drag';
}

document.getElementById('editorGridInner').addEventListener('mousedown', function (ev) {
  if (ev.button !== 0) return;
  var result = editorGridStart(ev.clientX, ev.clientY, ev.target);
  if (result) ev.preventDefault();
});

document.addEventListener('mousemove', function (ev) {
  if (!editorDrag) return;
  var wrap = document.getElementById('editorGridInner');
  editorApplyDragMove(editorClientToLocal(ev.clientX, ev.clientY, wrap));
});

document.addEventListener('mouseup', function () {
  editorFinalizeDrag();
});

document.getElementById('editorGridInner').addEventListener('touchstart', function (ev) {
  if (!editorChart) return;
  var pt = editorPointFromEvent(ev);
  var delBtn = ev.target.classList && ev.target.classList.contains('editor-note-delete') ? ev.target : null;
  var handleEl = !delBtn && ev.target.classList && ev.target.classList.contains('editor-note-handle') ? ev.target : null;
  var noteEl = !delBtn && !handleEl && ev.target.closest ? ev.target.closest('.editor-note') : null;

  if (delBtn) {
    ev.preventDefault();
    editorDeleteNote(delBtn._note);
    return;
  }
  if (handleEl || noteEl) {
    // Dragging an existing note or its handle always takes over the gesture (no scrolling while doing this).
    ev.preventDefault();
    editorGridStart(pt.x, pt.y, ev.target);
  } else {
    // Empty space: don't hijack the gesture yet, it might be a scroll. Decide on touchend.
    var wrap = document.getElementById('editorGridInner');
    var local = editorClientToLocal(pt.x, pt.y, wrap);
    editorTouchPending = { x: local.x, y: local.y, lane: editorLaneFromX(local.x) };
  }
}, { passive: false });

document.addEventListener('touchmove', function (ev) {
  if (editorDrag) {
    ev.preventDefault();
    var pt = editorPointFromEvent(ev);
    var wrap = document.getElementById('editorGridInner');
    editorApplyDragMove(editorClientToLocal(pt.x, pt.y, wrap));
  } else if (editorTouchPending) {
    var pt2 = editorPointFromEvent(ev);
    var wrap2 = document.getElementById('editorGridInner');
    var local2 = editorClientToLocal(pt2.x, pt2.y, wrap2);
    var dist = Math.abs(local2.y - editorTouchPending.y) + Math.abs(local2.x - editorTouchPending.x);
    if (dist > EDITOR_DRAG_PX_THRESHOLD * 3) editorTouchPending = null;
  }
}, { passive: false });

document.addEventListener('touchend', function () {
  if (editorDrag) {
    editorFinalizeDrag();
  } else if (editorTouchPending) {
    var t = Math.max(0, editorSnapTime(editorYToTime(editorTouchPending.y)));
    editorNotes.push({ t: t, d: editorTouchPending.lane, l: 0, p: [] });
    editorTouchPending = null;
    renderEditorGrid();
  }
});

document.getElementById('editorGridInner').addEventListener('contextmenu', function (ev) {
  var audio = document.getElementById('editorAudioEl');
  if (!audio.src) return;
  ev.preventDefault();
  var wrap = document.getElementById('editorGridInner');
  var local = editorClientToLocal(ev.clientX, ev.clientY, wrap);
  var t = editorYToTime(local.y);
  audio.currentTime = Math.max(0, t / 1000);
  updateEditorPlayhead();
});

var editorAudioCtx = null;
var editorAudioCompressor = null;

function setupEditorAudioGraph() {
  if (editorAudioCtx) return true;
  var AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;
  try {
    editorAudioCtx = new AudioContextClass();
    var audio = document.getElementById('editorAudioEl');
    var source = editorAudioCtx.createMediaElementSource(audio);
    editorAudioCompressor = editorAudioCtx.createDynamicsCompressor();
    source.connect(editorAudioCompressor);
    editorAudioCompressor.connect(editorAudioCtx.destination);
    applyEditorNormalizeState();
    return true;
  } catch (err) {
    editorAudioCtx = null;
    editorAudioCompressor = null;
    return false;
  }
}

function applyEditorNormalizeState() {
  if (!editorAudioCompressor) return;
  var enabled = document.getElementById('editorNormalizeAudio').checked;
  var t = editorAudioCtx.currentTime;
  if (enabled) {
    editorAudioCompressor.threshold.setValueAtTime(-30, t);
    editorAudioCompressor.knee.setValueAtTime(20, t);
    editorAudioCompressor.ratio.setValueAtTime(8, t);
    editorAudioCompressor.attack.setValueAtTime(0.02, t);
    editorAudioCompressor.release.setValueAtTime(0.3, t);
  } else {
    editorAudioCompressor.threshold.setValueAtTime(0, t);
    editorAudioCompressor.ratio.setValueAtTime(1, t);
  }
}

document.getElementById('editorNormalizeAudio').addEventListener('change', function () {
  if (setupEditorAudioGraph() && editorAudioCtx.state === 'suspended') editorAudioCtx.resume();
  applyEditorNormalizeState();
});

document.getElementById('editorAudioFileBtn').addEventListener('click', function () {
  document.getElementById('editorAudioFileInput').click();
});
document.getElementById('editorAudioFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('editorAudioFileLabel').textContent = file.name;
  var audio = document.getElementById('editorAudioEl');
  audio.src = URL.createObjectURL(file);
  audio.volume = toNumber(document.getElementById('editorVolume').value, 70) / 100;
  audio.load();
  document.getElementById('editorPlayBtn').disabled = false;
});

document.getElementById('editorVolume').addEventListener('input', function () {
  document.getElementById('editorAudioEl').volume = toNumber(this.value, 70) / 100;
});

document.getElementById('editorPlayBtn').addEventListener('click', function () {
  var audio = document.getElementById('editorAudioEl');
  if (audio.paused) {
    setupEditorAudioGraph();
    if (editorAudioCtx && editorAudioCtx.state === 'suspended') editorAudioCtx.resume();
    audio.play();
  } else {
    audio.pause();
  }
});


function formatEditorTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  var m = Math.floor(sec / 60);
  var s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function updateEditorPlayhead() {
  var audio = document.getElementById('editorAudioEl');
  var line = document.getElementById('editorPlayheadLine');
  if (audio && line) {
    var y = editorTimeToY(audio.currentTime * 1000);
    line.style.top = y + 'px';

    var wrap = document.getElementById('editorGridWrap');
    if (!audio.paused && wrap) {
      var viewH = wrap.clientHeight;
      var target = y - viewH * 0.3;
      if (Math.abs(wrap.scrollTop - target) > 2) wrap.scrollTop = target;
    }
  }
  if (audio) {
    document.getElementById('editorAudioTime').textContent = formatEditorTime(audio.currentTime) + ' / ' + formatEditorTime(audio.duration || 0);
  }
}

function editorAudioLoop() {
  var audio = document.getElementById('editorAudioEl');
  if (audio.paused) return;
  updateEditorPlayhead();
  requestAnimationFrame(editorAudioLoop);
}

document.getElementById('editorAudioEl').addEventListener('play', function () {
  document.getElementById('editorPlayBtn').textContent = 'Pause';
  editorAudioLoop();
});
document.getElementById('editorAudioEl').addEventListener('pause', function () {
  document.getElementById('editorPlayBtn').textContent = 'Play';
});
document.getElementById('editorAudioEl').addEventListener('ended', function () {
  document.getElementById('editorPlayBtn').textContent = 'Play';
});
document.getElementById('editorAudioEl').addEventListener('timeupdate', updateEditorPlayhead);
document.getElementById('editorAudioEl').addEventListener('loadedmetadata', function () {
  if (editorChart) renderEditorGrid();
});

document.getElementById('editorExportBtn').addEventListener('click', function () {
  if (!editorChart) return;
  var text = JSON.stringify(editorChart, null, 2);
  var temp = document.createElement('textarea');
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  setEditorStatus('Copied chart.json to clipboard.', 'ok');
});

document.getElementById('editorDownloadBtn').addEventListener('click', function () {
  if (!editorChart) return;
  var blob = new Blob([JSON.stringify(editorChart, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'chart.json';
  a.click();
  URL.revokeObjectURL(url);
});

function weekSlug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'week';
}

function weekFilenameFromName(name) {
  return String(name || 'Week').replace(/[^a-zA-Z0-9]+/g, '') || 'Week';
}

function convertPsychWeek(psychWeek, meta) {
  meta = meta || {};
  var songs = (psychWeek.songs || []).map(function (entry) {
    var name = Array.isArray(entry) ? entry[0] : entry;
    return String(name || '').toLowerCase();
  });
  var slug = weekSlug(psychWeek.weekName);
  var visible = meta.visible !== undefined ? meta.visible : (psychWeek.hideStoryMode !== undefined ? !psychWeek.hideStoryMode : true);

  return {
    version: '1.0.0',
    name: meta.name || psychWeek.weekName || 'Week',
    titleAsset: meta.titleAsset || ('storymenu/titles/' + slug),
    visible: visible,
    props: [],
    background: meta.background || '#000000',
    songs: songs
  };
}

function convertCodenameChart(codenameJson, meta) {
  meta = meta || {};
  var strumLines = codenameJson.strumLines || [];
  var noteTypes = codenameJson.noteTypes || [];
  var bpm = meta.bpm || 100;

  var notesOut = [];
  var nonPlayerStrumCount = 0;
  strumLines.forEach(function (sl) {
    if (sl.type !== 1) nonPlayerStrumCount++;
  });

  strumLines.forEach(function (sl) {
    var isPlayer = sl.type === 1;
    var laneOffset = isPlayer ? 0 : 4;
    (sl.notes || []).forEach(function (n) {
      var lane = Math.max(0, Math.min(3, n.id));
      var out = { t: n.time, d: lane + laneOffset, l: n.sLen || 0, p: [] };
      if (n.type) {
        var typeEntry = noteTypes[n.type];
        if (typeEntry) out.k = typeof typeEntry === 'string' ? typeEntry : (typeEntry.name || typeEntry.id || String(n.type));
      }
      notesOut.push(out);
    });
  });
  notesOut.sort(function (a, b) { return a.t - b.t; });

  var eventsOut = (codenameJson.events || []).map(function (ev) {
    if (ev.name === 'Camera Movement' && Array.isArray(ev.params) && ev.params.length) {
      return { t: ev.time, e: 'FocusCamera', v: { char: ev.params[0] } };
    }
    var v = {};
    (ev.params || []).forEach(function (p, i) { v['p' + (i + 1)] = p; });
    return { t: ev.time, e: ev.name, v: v };
  });
  eventsOut.sort(function (a, b) { return a.t - b.t; });

  var scrollSpeed = typeof codenameJson.scrollSpeed === 'number' ? codenameJson.scrollSpeed : 1;

  var chartOut = {
    version: '2.0.0',
    scrollSpeed: { easy: scrollSpeed, normal: scrollSpeed, hard: scrollSpeed },
    events: eventsOut,
    notes: {
      easy: JSON.parse(JSON.stringify(notesOut)),
      normal: JSON.parse(JSON.stringify(notesOut)),
      hard: JSON.parse(JSON.stringify(notesOut))
    },
    generatedBy: 'V Stuff'
  };

  var metadataOut = {
    version: '2.2.4',
    songName: meta.songName || 'Untitled',
    artist: meta.artist || '',
    charter: '',
    offsets: {},
    playData: {
      difficulties: ['easy', 'normal', 'hard'],
      characters: {
        player: 'bf',
        girlfriend: 'gf',
        opponent: 'dad',
        opponentVocals: ['dad'],
        playerVocals: ['bf']
      },
      stage: meta.stage || 'mainStage',
      noteStyle: 'funkin',
      ratings: { easy: 0, normal: 0, hard: 0 },
      album: ''
    },
    generatedBy: 'V Stuff',
    timeChanges: [{ t: 0, bpm: bpm }]
  };

  return { chart: chartOut, metadata: metadataOut, nonPlayerStrumCount: nonPlayerStrumCount, strumLineCount: strumLines.length };
}

function convertCodenameToPsychChart(codenameJson, meta) {
  meta = meta || {};
  var vsliceResult = convertCodenameChart(codenameJson, meta);
  var psychResult = convertVSliceToPsychChart(vsliceResult.chart, vsliceResult.metadata, {
    difficulty: meta.difficulty || 'normal',
    needsVoices: true
  });
  return {
    psych: psychResult,
    nonPlayerStrumCount: vsliceResult.nonPlayerStrumCount,
    strumLineCount: vsliceResult.strumLineCount,
    noteCount: (psychResult.song.notes || []).reduce(function (sum, section) { return sum + (section.sectionNotes || []).length; }, 0)
  };
}

function parseModMetaTxt(text) {
  var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l.length; });
  var songName = lines[0] || '';
  var artist = '';
  for (var i = 1; i < lines.length; i++) {
    var m = lines[i].match(/^Artist:\s*(.*)$/i);
    if (m) { artist = m[1].trim(); break; }
  }
  return { songName: songName, artist: artist };
}

function modChartMeta(songName, artist) {
  return { songName: songName || '', artist: artist || '', charter: '', album: '', stage: '', noteStyle: '', altCharter: '', spriteArtist: '', cutsceneArtist: '', stickerPack: '' };
}

var MOD_DEFAULT_CHAR_META = { name: '', renderType: '', assetPath: '', offsetX: 0, offsetY: 0, cameraOffsetX: null, cameraOffsetY: null, deathCameraOffsetX: null, deathCameraOffsetY: null };
var MOD_DEFAULT_STAGE_META = { name: '', isPixel: 'auto', bfZ: 300, dadZ: 200, gfZ: 100 };

function modStripRoot(files) {
  var paths = Object.keys(files).filter(function (p) { return !files[p].dir; });
  if (!paths.length) return { root: '', strip: function (p) { return p; } };
  var firstSegs = paths.map(function (p) { return p.split('/')[0]; });
  var allSame = firstSegs.every(function (s) { return s === firstSegs[0]; }) && paths.every(function (p) { return p.indexOf('/') !== -1; });
  if (allSame) {
    return { root: firstSegs[0], strip: function (p) { return p.substring(firstSegs[0].length + 1); } };
  }
  return { root: '', strip: function (p) { return p; } };
}

function modCapList(arr, cap) {
  if (arr.length <= cap) return arr.join(', ');
  return arr.slice(0, cap).join(', ') + ', and ' + (arr.length - cap) + ' more';
}

async function convertModFolderZip(file) {
  var inZip = await JSZip.loadAsync(file);
  var rootInfo = modStripRoot(inZip.files);

  var characterFiles = [];
  var stageBase = {};
  var songFolders = {};
  var directCopies = [];
  var skipped = {};
  var weekFiles = [];

  function addSkip(reason, path) {
    if (!skipped[reason]) skipped[reason] = [];
    skipped[reason].push(path);
  }

  var allPaths = Object.keys(inZip.files);
  for (var i = 0; i < allPaths.length; i++) {
    var rawPath = allPaths[i];
    var entry = inZip.files[rawPath];
    if (entry.dir) continue;
    var relPath = rootInfo.strip(rawPath);
    if (!relPath) continue;

    var m;
    if ((m = relPath.match(/^characters\/([^\/]+\.json)$/i))) {
      characterFiles.push({ path: rawPath, filename: m[1] });
    } else if ((m = relPath.match(/^stages\/([^\/]+)\.lua$/i))) {
      stageBase[m[1]] = stageBase[m[1]] || {};
      stageBase[m[1]].lua = rawPath;
    } else if ((m = relPath.match(/^stages\/([^\/]+)\.json$/i))) {
      stageBase[m[1]] = stageBase[m[1]] || {};
      stageBase[m[1]].json = rawPath;
    } else if ((m = relPath.match(/^data\/([^\/]+)\/events\.json$/i))) {
      songFolders[m[1]] = songFolders[m[1]] || {};
      songFolders[m[1]].events = rawPath;
    } else if ((m = relPath.match(/^data\/([^\/]+)\/meta\.txt$/i))) {
      songFolders[m[1]] = songFolders[m[1]] || {};
      songFolders[m[1]].meta = rawPath;
    } else if ((m = relPath.match(/^data\/([^\/]+)\/([^\/]+)\.json$/i)) && m[2].toLowerCase() === m[1].toLowerCase()) {
      songFolders[m[1]] = songFolders[m[1]] || {};
      songFolders[m[1]].chart = rawPath;
    } else if (/^data\/[^\/]+\/.+\.lua$/i.test(relPath)) {
      addSkip('Per-song Lua scripts (custom code, not data)', relPath);
    } else if (/^data\/[^\/]+\/.*(Dialogue|GameOver)[^\/]*\.txt$/i.test(relPath)) {
      addSkip('Dialogue / cutscene text files', relPath);
    } else if (/^data\/(characterList|stageList|weekList|freeplayColors|introText|specialThanks|data-goes-here)\.txt$/i.test(relPath) || /^data\/main-view\.xml$/i.test(relPath)) {
      addSkip('Psych-specific config files', relPath);
    } else if ((m = relPath.match(/^weeks\/([^\/]+)\.json$/i))) {
      weekFiles.push({ path: rawPath, name: m[1] });
    } else if (/^weeks\//i.test(relPath)) {
      addSkip('Week/story menu files', relPath);
    } else if (/^custom_events\//i.test(relPath)) {
      addSkip('Custom event definitions (no V-Slice equivalent)', relPath);
    } else if ((m = relPath.match(/^songs\/([^\/]+)\/(.+\.ogg)$/i))) {
      directCopies.push({ src: rawPath, dest: 'songs/' + m[1] + '/' + m[2] });
    } else if ((m = relPath.match(/^images\/characters\/(.+)$/i))) {
      directCopies.push({ src: rawPath, dest: 'shared/images/characters/' + m[1] });
    } else if ((m = relPath.match(/^images\/icons\/([^\/]+\.png)$/i))) {
      directCopies.push({ src: rawPath, dest: 'images/icons/' + m[1] });
    } else if (/^images\/icons\//i.test(relPath)) {
      addSkip('Nested icon subfolders (credits etc — UI-only)', relPath);
    } else if (/^images\/(pixelUI|menudifficulties|storymenu)\//i.test(relPath)) {
      addSkip('Psych UI-only image folders', relPath);
    } else if ((m = relPath.match(/^images\/([^\/]+)\/(.+)$/i))) {
      directCopies.push({ src: rawPath, dest: 'shared/images/stages/' + m[1] + '/' + m[2] });
    } else if (/^images\/[^\/]+$/i.test(relPath)) {
      addSkip('Top-level UI images (menus, HUD, notes)', relPath);
    } else if (/^music\//i.test(relPath)) {
      addSkip('Menu music (different system in V-Slice)', relPath);
    } else if (/^sounds\//i.test(relPath)) {
      addSkip('Menu/UI sound effects (different system in V-Slice)', relPath);
    } else {
      addSkip('Other unrecognized files', relPath);
    }
  }

  var outZip = new JSZip();
  var outRoot = (rootInfo.root || 'converted-mod') + ' (V-Slice)';
  var counts = { characters: 0, stages: 0, songs: 0, copied: 0, levels: 0 };
  var errors = [];

  for (var ci = 0; ci < characterFiles.length; ci++) {
    var cf = characterFiles[ci];
    try {
      var charText = await inZip.files[cf.path].async('string');
      var psychChar = JSON.parse(charText);
      var outChar = convertPsychCharacter(psychChar, MOD_DEFAULT_CHAR_META);
      outZip.file(outRoot + '/data/characters/' + cf.filename, JSON.stringify(outChar, null, 2));
      counts.characters++;
    } catch (err) {
      errors.push('Character ' + cf.filename + ': ' + err.message);
    }
  }

  var stageBaseNames = Object.keys(stageBase);
  for (var si = 0; si < stageBaseNames.length; si++) {
    var baseName = stageBaseNames[si];
    var stageEntry = stageBase[baseName];
    if (!stageEntry.json) continue;
    try {
      var stageText = await inZip.files[stageEntry.json].async('string');
      var stageJson = JSON.parse(stageText);
      var luaText = stageEntry.lua ? await inZip.files[stageEntry.lua].async('string') : '';
      var stageResult = convertPsychStage(stageJson, luaText, MOD_DEFAULT_STAGE_META);
      outZip.file(outRoot + '/data/stages/' + baseName + '.json', JSON.stringify(stageResult.stage, null, 2));
      counts.stages++;
    } catch (err) {
      errors.push('Stage ' + baseName + ': ' + err.message);
    }
  }

  var songIds = Object.keys(songFolders);
  for (var sfi = 0; sfi < songIds.length; sfi++) {
    var songId = songIds[sfi];
    var sf = songFolders[songId];
    if (!sf.chart) {
      addSkip('Song folders missing a matching <folder>.json chart', 'data/' + songId + '/');
      continue;
    }
    try {
      var chartText = await inZip.files[sf.chart].async('string');
      var chartJson = JSON.parse(chartText);
      if (sf.events) {
        var eventsText = await inZip.files[sf.events].async('string');
        var eventsJson = JSON.parse(eventsText);
        var extEvents = (eventsJson.song && eventsJson.song.events) || [];
        if (extEvents.length) chartJson.song.events = extEvents;
      }
      var songName = '', artist = '';
      if (sf.meta) {
        var metaText = await inZip.files[sf.meta].async('string');
        var parsedMeta = parseModMetaTxt(metaText);
        songName = parsedMeta.songName;
        artist = parsedMeta.artist;
      }
      var chartResult = convertPsychChart(chartJson, modChartMeta(songName, artist));
      outZip.file(outRoot + '/data/songs/' + songId + '/' + songId + '-chart.json', JSON.stringify(chartResult.chart, null, 2));
      outZip.file(outRoot + '/data/songs/' + songId + '/' + songId + '-metadata.json', JSON.stringify(chartResult.metadata, null, 2));
      counts.songs++;
    } catch (err) {
      errors.push('Song ' + songId + ': ' + err.message);
    }
  }

  for (var di = 0; di < directCopies.length; di++) {
    var dc = directCopies[di];
    try {
      var buf = await inZip.files[dc.src].async('arraybuffer');
      outZip.file(outRoot + '/' + dc.dest, buf);
      counts.copied++;
    } catch (err) {
      errors.push('Copy ' + dc.src + ': ' + err.message);
    }
  }

  var levelLines = [];
  var levelFilenames = {};
  for (var wi = 0; wi < weekFiles.length; wi++) {
    try {
      var weekText = await inZip.files[weekFiles[wi].path].async('string');
      var weekJson = JSON.parse(weekText);
      var levelResult = convertPsychWeek(weekJson, {});
      var levelFilename = weekFilenameFromName(levelResult.name);
      if (levelFilenames[levelFilename]) levelFilename = levelFilename + '_' + weekFiles[wi].name;
      levelFilenames[levelFilename] = true;
      outZip.file(outRoot + '/data/levels/' + levelFilename + '.json', JSON.stringify(levelResult, null, 2));
      counts.levels++;
      levelLines.push('  ' + levelResult.name + ' (data/levels/' + levelFilename + '.json): ' + levelResult.songs.join(', '));
    } catch (err) {
      errors.push('Week ' + weekFiles[wi].name + ': ' + err.message);
    }
  }

  var polymodMeta = {
    title: rootInfo.root || 'Converted Mod',
    description: 'Converted from a Psych Engine mod by V Stuff. Edit this description.',
    contributors: [],
    api_version: '0.8.6',
    mod_version: '1.0.0',
    license: ''
  };
  outZip.file(outRoot + '/_polymod_meta.json', JSON.stringify(polymodMeta, null, 2));

  var report = [];
  report.push('V Stuff — Mod Folder Conversion Report');
  report.push('Source: ' + (rootInfo.root || file.name));
  report.push('');
  report.push('Converted automatically:');
  report.push('  characters: ' + counts.characters);
  report.push('  stages: ' + counts.stages);
  report.push('  songs (chart + metadata): ' + counts.songs);
  report.push('  levels (from weeks): ' + counts.levels);
  report.push('  files copied directly (audio/images): ' + counts.copied);

  if (errors.length) {
    report.push('');
    report.push('Errors (these files did not convert):');
    errors.forEach(function (e) { report.push('  - ' + e); });
  }

  if (levelLines.length) {
    report.push('');
    report.push('Levels converted from weeks (song list + visibility only — props/titleAsset/background are placeholders, since Psych has no story-menu art to pull from):');
    levelLines.forEach(function (l) { report.push(l); });
  }

  var skipReasons = Object.keys(skipped);
  if (skipReasons.length) {
    report.push('');
    report.push('Not converted — needs manual attention:');
    skipReasons.forEach(function (reason) {
      report.push('  ' + reason + ' (' + skipped[reason].length + '): ' + modCapList(skipped[reason], 5));
    });
  }

  report.push('');
  report.push('_polymod_meta.json was generated with placeholder description/version — edit it before publishing.');

  var outBlob = await outZip.generateAsync({ type: 'blob' });
  return { blob: outBlob, report: report.join('\n'), outRoot: outRoot };
}

var lastModResult = null;

function setModStatus(text, kind) {
  var el = document.getElementById('modStatus');
  el.textContent = text;
  el.className = kind || '';
}

document.getElementById('modZipFileBtn').addEventListener('click', function () {
  document.getElementById('modZipFileInput').click();
});
document.getElementById('modZipFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('modZipFileLabel').textContent = file.name;
});

document.getElementById('modConvertBtn').addEventListener('click', function () {
  var fileInput = document.getElementById('modZipFileInput');
  var file = fileInput.files[0];
  if (!file) {
    setModStatus('Upload a mod folder .zip first.', 'err');
    return;
  }

  setModStatus('Converting — this can take a moment for mods with a lot of images...', '');
  document.getElementById('modOutputActions').style.display = 'none';

  convertModFolderZip(file).then(function (result) {
    lastModResult = result;
    var wrap = document.getElementById('modOutputWrap');
    wrap.innerHTML = '<textarea readonly spellcheck="false" style="width:100%; height:420px;"></textarea>';
    wrap.querySelector('textarea').value = result.report;
    document.getElementById('modOutputActions').style.display = 'flex';
    setModStatus('Done.', 'ok');
  }).catch(function (err) {
    setModStatus('Conversion failed: ' + err.message, 'err');
  });
});

document.getElementById('modDownloadBtn').addEventListener('click', function () {
  if (!lastModResult) return;
  var url = URL.createObjectURL(lastModResult.blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'converted-mod.zip';
  a.click();
  URL.revokeObjectURL(url);
});

function setWeekStatus(text, kind) {
  var el = document.getElementById('weekStatus');
  el.textContent = text;
  el.className = kind || '';
}

document.getElementById('weekFileBtn').addEventListener('click', function () {
  document.getElementById('weekFileInput').click();
});
document.getElementById('weekFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('weekFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) {
    document.getElementById('weekInput').value = ev.target.result;
    autofillWeekFields();
  };
  reader.readAsText(file);
});

document.getElementById('weekInput').addEventListener('input', autofillWeekFields);

var weekAutofillTouched = { name: false, titleAsset: false, background: false, visible: false };
document.getElementById('weekName').addEventListener('input', function () { weekAutofillTouched.name = true; });
document.getElementById('weekTitleAsset').addEventListener('input', function () { weekAutofillTouched.titleAsset = true; });
document.getElementById('weekBackground').addEventListener('input', function () { weekAutofillTouched.background = true; });
document.getElementById('weekVisible').addEventListener('change', function () { weekAutofillTouched.visible = true; });

function autofillWeekFields() {
  var raw = document.getElementById('weekInput').value.trim();
  if (!raw) return;
  var parsed;
  try {
    parsed = safeJsonParse(raw);
  } catch (err) {
    return;
  }
  if (!weekAutofillTouched.name && parsed.weekName) document.getElementById('weekName').value = parsed.weekName;
  if (!weekAutofillTouched.titleAsset) document.getElementById('weekTitleAsset').value = 'storymenu/titles/' + weekSlug(parsed.weekName);
  if (!weekAutofillTouched.visible && parsed.hideStoryMode !== undefined) {
    document.getElementById('weekVisible').value = parsed.hideStoryMode ? 'false' : 'true';
  }
}

document.getElementById('weekConvertBtn').addEventListener('click', function () {
  var raw = document.getElementById('weekInput').value.trim();
  if (!raw) {
    setWeekStatus('Paste or upload a Psych week JSON first.', 'err');
    return;
  }
  var parsed;
  try {
    parsed = safeJsonParse(raw);
  } catch (err) {
    setWeekStatus('JSON doesn\'t parse: ' + err.message, 'err');
    return;
  }

  var meta = {
    name: document.getElementById('weekName').value.trim(),
    titleAsset: document.getElementById('weekTitleAsset').value.trim(),
    background: document.getElementById('weekBackground').value.trim(),
    visible: document.getElementById('weekVisible').value === 'true'
  };

  var result = convertPsychWeek(parsed, meta);
  document.getElementById('weekOutput').value = JSON.stringify(result, null, 2);
  setWeekStatus('Converted ' + result.songs.length + ' song(s). Save as data/levels/' + weekFilenameFromName(result.name) + '.json.', 'ok');
});

document.getElementById('weekCopyBtn').addEventListener('click', function () {
  var text = document.getElementById('weekOutput').value;
  if (!text) return;
  var temp = document.createElement('textarea');
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  setWeekStatus('Copied to clipboard.', 'ok');
});

document.getElementById('weekDownloadBtn').addEventListener('click', function () {
  var text = document.getElementById('weekOutput').value;
  if (!text) return;
  var name = weekFilenameFromName(document.getElementById('weekName').value.trim() || 'Week');
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

var lastCodenameResult = null;

function setCodenameStatus(text, kind) {
  var el = document.getElementById('codenameStatus');
  el.textContent = text;
  el.className = kind || '';
}

document.getElementById('codenameFileBtn').addEventListener('click', function () {
  document.getElementById('codenameFileInput').click();
});
document.getElementById('codenameFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('codenameFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) { document.getElementById('codenameInput').value = ev.target.result; };
  reader.onerror = function () { setCodenameStatus('Could not read that file.', 'err'); };
  reader.readAsText(file);
});

document.getElementById('codenameConvertBtn').addEventListener('click', function () {
  var raw = document.getElementById('codenameInput').value.trim();
  if (!raw) {
    setCodenameStatus('Paste or upload a Codename chart first.', 'err');
    return;
  }
  var parsed;
  try {
    parsed = safeJsonParse(raw);
  } catch (err) {
    setCodenameStatus('JSON doesn\'t parse: ' + err.message, 'err');
    return;
  }
  if (!parsed.strumLines) {
    setCodenameStatus('That doesn\'t look like a Codename chart — no "strumLines" array found.', 'err');
    return;
  }

  var meta = {
    songName: document.getElementById('codenameSongName').value.trim(),
    artist: document.getElementById('codenameArtist').value.trim(),
    bpm: toNumber(document.getElementById('codenameBpm').value, 100),
    stage: document.getElementById('codenameStage').value.trim()
  };

  lastCodenameResult = convertCodenameChart(parsed, meta);

  var wrap = document.getElementById('codenameOutputWrap');
  wrap.innerHTML =
    '<label class="first">chart.json</label>' +
    '<textarea id="codenameChartOutput" readonly spellcheck="false" style="height:200px;"></textarea>' +
    '<label class="first">metadata.json</label>' +
    '<textarea id="codenameMetaOutput" readonly spellcheck="false" style="height:160px;"></textarea>';
  document.getElementById('codenameChartOutput').value = JSON.stringify(lastCodenameResult.chart, null, 2);
  document.getElementById('codenameMetaOutput').value = JSON.stringify(lastCodenameResult.metadata, null, 2);
  document.getElementById('codenameOutputActions').style.display = 'flex';

  var noteCount = lastCodenameResult.chart.notes.normal.length;
  var warn = lastCodenameResult.nonPlayerStrumCount > 1 ? ' — heads up: ' + lastCodenameResult.nonPlayerStrumCount + ' non-player strumlines were merged onto lanes 4-7 and are no longer distinguishable.' : '';
  setCodenameStatus('Converted ' + noteCount + ' notes from ' + lastCodenameResult.strumLineCount + ' strumline(s).' + warn, warn ? 'err' : 'ok');
});

document.getElementById('codenameCopyChartBtn').addEventListener('click', function () {
  if (!lastCodenameResult) return;
  var temp = document.createElement('textarea');
  temp.value = JSON.stringify(lastCodenameResult.chart, null, 2);
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  setCodenameStatus('Copied chart.json.', 'ok');
});

document.getElementById('codenameCopyMetaBtn').addEventListener('click', function () {
  if (!lastCodenameResult) return;
  var temp = document.createElement('textarea');
  temp.value = JSON.stringify(lastCodenameResult.metadata, null, 2);
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  setCodenameStatus('Copied metadata.json.', 'ok');
});

document.getElementById('codenameDownloadBtn').addEventListener('click', function () {
  if (!lastCodenameResult) return;
  var songSlug = (document.getElementById('codenameSongName').value.trim() || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'song';
  [
    { data: lastCodenameResult.chart, name: songSlug + '-chart.json' },
    { data: lastCodenameResult.metadata, name: songSlug + '-metadata.json' }
  ].forEach(function (f) {
    var blob = new Blob([JSON.stringify(f.data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);
  });
});

var lastCodenameToPsychResult = null;

function setCodenameToPsychStatus(text, kind) {
  var el = document.getElementById('codenameToPsychStatus');
  el.textContent = text;
  el.className = kind || '';
}

document.getElementById('codenameToPsychFileBtn').addEventListener('click', function () {
  document.getElementById('codenameToPsychFileInput').click();
});
document.getElementById('codenameToPsychFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('codenameToPsychFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) { document.getElementById('codenameToPsychInput').value = ev.target.result; };
  reader.onerror = function () { setCodenameToPsychStatus('Could not read that file.', 'err'); };
  reader.readAsText(file);
});

document.getElementById('codenameToPsychConvertBtn').addEventListener('click', function () {
  var raw = document.getElementById('codenameToPsychInput').value.trim();
  if (!raw) {
    setCodenameToPsychStatus('Paste or upload a Codename chart first.', 'err');
    return;
  }
  var parsed;
  try {
    parsed = safeJsonParse(raw);
  } catch (err) {
    setCodenameToPsychStatus('JSON doesn\'t parse: ' + err.message, 'err');
    return;
  }
  if (!parsed.strumLines) {
    setCodenameToPsychStatus('That doesn\'t look like a Codename chart — no "strumLines" array found.', 'err');
    return;
  }

  var meta = {
    songName: document.getElementById('codenameToPsychSongName').value.trim(),
    difficulty: document.getElementById('codenameToPsychDifficulty').value.trim() || 'normal',
    bpm: toNumber(document.getElementById('codenameToPsychBpm').value, 100),
    stage: document.getElementById('codenameToPsychStage').value.trim()
  };

  try {
    lastCodenameToPsychResult = convertCodenameToPsychChart(parsed, meta);
    document.getElementById('codenameToPsychOutput').value = JSON.stringify(lastCodenameToPsychResult.psych, null, 2);
    var warn = lastCodenameToPsychResult.nonPlayerStrumCount > 1 ? ' — heads up: ' + lastCodenameToPsychResult.nonPlayerStrumCount + ' non-player strumlines were merged onto lanes 4-7 and are no longer distinguishable.' : '';
    setCodenameToPsychStatus('Converted ' + lastCodenameToPsychResult.noteCount + ' notes from ' + lastCodenameToPsychResult.strumLineCount + ' strumline(s).' + warn, warn ? 'err' : 'ok');
  } catch (err) {
    setCodenameToPsychStatus('Could not convert: ' + err.message, 'err');
  }
});

document.getElementById('codenameToPsychCopyBtn').addEventListener('click', function () {
  var text = document.getElementById('codenameToPsychOutput').value;
  if (!text) return;
  var temp = document.createElement('textarea');
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  setCodenameToPsychStatus('Copied to clipboard.', 'ok');
});

document.getElementById('codenameToPsychDownloadBtn').addEventListener('click', function () {
  var text = document.getElementById('codenameToPsychOutput').value;
  if (!text) return;
  var songSlug = (document.getElementById('codenameToPsychSongName').value.trim() || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'song';
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = songSlug + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

function setCodenameToPsychCharStatus(text, kind) {
  var el = document.getElementById('codenameToPsychCharStatus');
  el.textContent = text;
  el.className = kind || '';
}

document.getElementById('codenameToPsychCharFileBtn').addEventListener('click', function () {
  document.getElementById('codenameToPsychCharFileInput').click();
});
document.getElementById('codenameToPsychCharFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('codenameToPsychCharFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) { document.getElementById('codenameToPsychCharInput').value = ev.target.result; };
  reader.onerror = function () { setCodenameToPsychCharStatus('Could not read that file.', 'err'); };
  reader.readAsText(file);
});

document.getElementById('codenameToPsychCharConvertBtn').addEventListener('click', function () {
  var raw = document.getElementById('codenameToPsychCharInput').value.trim();
  if (!raw) {
    setCodenameToPsychCharStatus('Paste or upload a Codename character XML first.', 'err');
    return;
  }
  var meta = {
    image: document.getElementById('codenameToPsychCharImage').value.trim(),
    healthicon: document.getElementById('codenameToPsychCharIcon').value.trim()
  };
  try {
    var result = convertCodenameToPsychCharacter(raw, meta);
    document.getElementById('codenameToPsychCharOutput').value = JSON.stringify(result, null, 2);
    setCodenameToPsychCharStatus('Converted ' + result.animations.length + ' animation(s).' + (result._editor_isPlayer ? ' Marked as player.' : ''), 'ok');
  } catch (err) {
    setCodenameToPsychCharStatus('Could not convert: ' + err.message, 'err');
  }
});

document.getElementById('codenameToPsychCharCopyBtn').addEventListener('click', function () {
  var text = document.getElementById('codenameToPsychCharOutput').value;
  if (!text) return;
  var temp = document.createElement('textarea');
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  setCodenameToPsychCharStatus('Copied to clipboard.', 'ok');
});

document.getElementById('codenameToPsychCharDownloadBtn').addEventListener('click', function () {
  var text = document.getElementById('codenameToPsychCharOutput').value;
  if (!text) return;
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'character.json';
  a.click();
  URL.revokeObjectURL(url);
});

var lastCodenameToPsychStageResult = null;
var activeCodenameToPsychStageTab = 'json';

function setCodenameToPsychStageStatus(text, kind) {
  var el = document.getElementById('codenameToPsychStageStatus');
  el.textContent = text;
  el.className = kind || '';
}

function renderCodenameToPsychStageOutput() {
  var wrap = document.getElementById('codenameToPsychStageOutputWrap');
  var actions = document.getElementById('codenameToPsychStageOutputActions');

  if (!lastCodenameToPsychStageResult) {
    wrap.innerHTML = '<div class="empty-state">Convert a stage to see the output here.</div>';
    actions.style.display = 'none';
    document.getElementById('codenameToPsychStageDynamicNotes').innerHTML = '';
    return;
  }

  wrap.innerHTML = '<textarea id="codenameToPsychStageOutputArea" readonly spellcheck="false" style="width:100%;height:380px;"></textarea>';
  var text = activeCodenameToPsychStageTab === 'json' ? JSON.stringify(lastCodenameToPsychStageResult.stage, null, 2) : lastCodenameToPsychStageResult.lua;
  document.getElementById('codenameToPsychStageOutputArea').value = text;
  actions.style.display = 'flex';

  var notesHtml = '';
  if (lastCodenameToPsychStageResult.scaleWarnings.length) {
    notesHtml += '<div class="notes-info"><strong>Scale not reproduced for</strong> — ' + lastCodenameToPsychStageResult.scaleWarnings.join(', ') + '. Add setGraphicSize calls by hand for these.</div>';
  }
  if (lastCodenameToPsychStageResult.nonSparrowWarnings.length) {
    notesHtml += '<div class="notes-info"><strong>Non-sparrow props (double check these)</strong> — ' + lastCodenameToPsychStageResult.nonSparrowWarnings.join(', ') + '.</div>';
  }
  document.getElementById('codenameToPsychStageDynamicNotes').innerHTML = notesHtml;
}

document.getElementById('tabCodenameToPsychStageJson').addEventListener('click', function () {
  activeCodenameToPsychStageTab = 'json';
  document.getElementById('tabCodenameToPsychStageJson').classList.add('active');
  document.getElementById('tabCodenameToPsychStageLua').classList.remove('active');
  renderCodenameToPsychStageOutput();
});

document.getElementById('tabCodenameToPsychStageLua').addEventListener('click', function () {
  activeCodenameToPsychStageTab = 'lua';
  document.getElementById('tabCodenameToPsychStageLua').classList.add('active');
  document.getElementById('tabCodenameToPsychStageJson').classList.remove('active');
  renderCodenameToPsychStageOutput();
});

document.getElementById('codenameToPsychStageFileBtn').addEventListener('click', function () {
  document.getElementById('codenameToPsychStageFileInput').click();
});
document.getElementById('codenameToPsychStageFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('codenameToPsychStageFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) { document.getElementById('codenameToPsychStageInput').value = ev.target.result; };
  reader.onerror = function () { setCodenameToPsychStageStatus('Could not read that file.', 'err'); };
  reader.readAsText(file);
});

document.getElementById('codenameToPsychStageConvertBtn').addEventListener('click', function () {
  var raw = document.getElementById('codenameToPsychStageInput').value.trim();
  if (!raw) {
    setCodenameToPsychStageStatus('Paste or upload a Codename stage XML first.', 'err');
    return;
  }
  var meta = {
    isPixel: document.getElementById('codenameToPsychStageIsPixel').value,
    cameraSpeed: toNumber(document.getElementById('codenameToPsychStageCameraSpeed').value, 1)
  };
  try {
    lastCodenameToPsychStageResult = convertCodenameToPsychStage(raw, meta);
    setCodenameToPsychStageStatus('Converted ' + lastCodenameToPsychStageResult.propCount + ' prop(s) into Lua.' + (lastCodenameToPsychStageResult.stage.hide_girlfriend ? ' No girlfriend tag found — marked hidden.' : ''), 'ok');
    renderCodenameToPsychStageOutput();
  } catch (err) {
    setCodenameToPsychStageStatus('Could not convert: ' + err.message, 'err');
  }
});

document.getElementById('codenameToPsychStageCopyBtn').addEventListener('click', function () {
  var area = document.getElementById('codenameToPsychStageOutputArea');
  if (!area) return;
  area.select();
  document.execCommand('copy');
  setCodenameToPsychStageStatus('Copied ' + (activeCodenameToPsychStageTab === 'json' ? 'stage.json' : 'stage.lua') + ' to clipboard.', 'ok');
});

document.getElementById('codenameToPsychStageDownloadBtn').addEventListener('click', function () {
  if (!lastCodenameToPsychStageResult) return;
  var isJson = activeCodenameToPsychStageTab === 'json';
  var content = isJson ? JSON.stringify(lastCodenameToPsychStageResult.stage, null, 2) : lastCodenameToPsychStageResult.lua;
  var filename = isJson ? 'stage.json' : 'stage.lua';
  var blob = new Blob([content], { type: isJson ? 'application/json' : 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

function setCodenameCharStatus(text, kind) {
  var el = document.getElementById('codenameCharStatus');
  el.textContent = text;
  el.className = kind || '';
}

document.getElementById('codenameCharFileBtn').addEventListener('click', function () {
  document.getElementById('codenameCharFileInput').click();
});
document.getElementById('codenameCharFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('codenameCharFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) { document.getElementById('codenameCharInput').value = ev.target.result; };
  reader.onerror = function () { setCodenameCharStatus('Could not read that file.', 'err'); };
  reader.readAsText(file);
});

document.getElementById('codenameCharConvertBtn').addEventListener('click', function () {
  var raw = document.getElementById('codenameCharInput').value.trim();
  if (!raw) {
    setCodenameCharStatus('Paste or upload a Codename character XML first.', 'err');
    return;
  }
  var meta = {
    name: document.getElementById('codenameCharName').value.trim(),
    renderType: document.getElementById('codenameCharRenderType').value,
    assetPath: document.getElementById('codenameCharAssetPath').value.trim(),
    cameraOffsetX: toNumber(document.getElementById('codenameCharCamX').value, null),
    cameraOffsetY: toNumber(document.getElementById('codenameCharCamY').value, null)
  };
  try {
    var result = convertCodenameCharacter(raw, meta);
    document.getElementById('codenameCharOutput').value = JSON.stringify(result, null, 2);
    setCodenameCharStatus('Converted ' + result.animations.length + ' animation(s)' + (result.death ? ', death animation detected' : '') + '.', 'ok');
  } catch (err) {
    setCodenameCharStatus('Could not convert: ' + err.message, 'err');
  }
});

document.getElementById('codenameCharCopyBtn').addEventListener('click', function () {
  var text = document.getElementById('codenameCharOutput').value;
  if (!text) return;
  var temp = document.createElement('textarea');
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  setCodenameCharStatus('Copied to clipboard.', 'ok');
});

document.getElementById('codenameCharDownloadBtn').addEventListener('click', function () {
  var text = document.getElementById('codenameCharOutput').value;
  if (!text) return;
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'character.json';
  a.click();
  URL.revokeObjectURL(url);
});

function setCodenameStageStatus(text, kind) {
  var el = document.getElementById('codenameStageStatus');
  el.textContent = text;
  el.className = kind || '';
}

document.getElementById('codenameStageFileBtn').addEventListener('click', function () {
  document.getElementById('codenameStageFileInput').click();
});
document.getElementById('codenameStageFileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  document.getElementById('codenameStageFileLabel').textContent = file.name;
  var reader = new FileReader();
  reader.onload = function (ev) { document.getElementById('codenameStageInput').value = ev.target.result; };
  reader.onerror = function () { setCodenameStageStatus('Could not read that file.', 'err'); };
  reader.readAsText(file);
});

document.getElementById('codenameStageConvertBtn').addEventListener('click', function () {
  var raw = document.getElementById('codenameStageInput').value.trim();
  if (!raw) {
    setCodenameStageStatus('Paste or upload a Codename stage XML first.', 'err');
    return;
  }
  var meta = { name: document.getElementById('codenameStageName').value.trim() };
  try {
    var result = convertCodenameStage(raw, meta);
    document.getElementById('codenameStageOutput').value = JSON.stringify(result, null, 2);
    var gfNote = result.characters.gf.alpha === 0 ? ' (no girlfriend tag found — marked hidden)' : '';
    setCodenameStageStatus('Converted ' + result.props.length + ' prop(s)' + gfNote + '.', 'ok');
  } catch (err) {
    setCodenameStageStatus('Could not convert: ' + err.message, 'err');
  }
});

document.getElementById('codenameStageCopyBtn').addEventListener('click', function () {
  var text = document.getElementById('codenameStageOutput').value;
  if (!text) return;
  var temp = document.createElement('textarea');
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  setCodenameStageStatus('Copied to clipboard.', 'ok');
});

document.getElementById('codenameStageDownloadBtn').addEventListener('click', function () {
  var text = document.getElementById('codenameStageOutput').value;
  if (!text) return;
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'stage.json';
  a.click();
  URL.revokeObjectURL(url);
});

(function () {
  var overlay = document.getElementById('introOverlay');
  if (!overlay) return;

  var seen = false;
  try {
    seen = sessionStorage.getItem('vstuffIntroSeen') === '1';
  } catch (err) {
    seen = false;
  }

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (seen || reduced) {
    overlay.style.display = 'none';
    return;
  }

  try {
    sessionStorage.setItem('vstuffIntroSeen', '1');
  } catch (err) {}

  var dismissed = false;
  function dismissIntro() {
    if (dismissed) return;
    dismissed = true;
    overlay.classList.add('intro-hide');
    setTimeout(function () { overlay.style.display = 'none'; }, 550);
  }

  overlay.addEventListener('click', dismissIntro);
  setTimeout(dismissIntro, 3400);
})();
