import * as alphaTab from '@coderline/alphatab';
import './style.css';

const supportedFormats = '.gp,.gp3,.gp4,.gp5,.gp6,.gp7,.gpx,.musicxml,.xml';

document.querySelector('#app').innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>Guitar Pro Player</h1>
        <p id="songInfo">Откройте файл Guitar Pro, чтобы посмотреть и проиграть ноты.</p>
      </div>
      <label class="fileButton" title="Открыть файл">
        <input id="fileInput" type="file" accept="${supportedFormats}" />
        <span aria-hidden="true">+</span>
        Открыть
      </label>
    </header>

    <section class="controls" aria-label="Плеер">
      <button id="playPauseButton" class="primaryButton" type="button" title="Играть или пауза" disabled>
        <span id="playIcon" aria-hidden="true">Play</span>
        <span id="playLabel">Играть</span>
      </button>
      <button id="stopButton" type="button" title="Остановить" disabled>
        <span aria-hidden="true">Stop</span>
        Стоп
      </button>
      <div class="progressWrap" aria-label="Позиция">
        <span id="currentTime">0:00</span>
        <input id="progress" type="range" min="0" max="1000" value="0" disabled />
        <span id="totalTime">0:00</span>
      </div>
      <label class="tempoControl" title="Скорость проигрывания">
        Темп
        <input id="speed" type="range" min="25" max="200" value="100" />
        <span id="speedValue">100%</span>
      </label>
      <label class="soundLibraryControl" title="Банк сэмплов для проигрывания">
        Библиотека
        <select id="soundLibrary">
          <option value="musescore">MuseScore General</option>
          <option value="sonivox">Sonivox</option>
          <option value="custom">Своя SF2/SF3</option>
        </select>
      </label>
      <label class="soundfontButton" title="Загрузить свою библиотеку сэмплов">
        <input id="soundfontInput" type="file" accept=".sf2,.sf3" />
        SF2/SF3
      </label>
    </section>

    <section class="workspace">
      <section class="scorePanel">
        <div id="status" class="status">Готов к открытию файлов GP3, GP4, GP5, GPX/GP6 и GP/GP7.</div>
        <div id="alphaTab" class="notation"></div>
      </section>
      <aside class="tracksPanel">
        <div class="tracksPanelHeader">
          <h2>Дорожки</h2>
          <button id="showAllButton" class="panelButton" type="button" title="Показать ноты всех дорожек" disabled>Все</button>
        </div>
        <div id="tracks" class="tracksEmpty">Пока файл не выбран.</div>
      </aside>
    </section>
  </main>
`;

const fileInput = document.querySelector('#fileInput');
const playPauseButton = document.querySelector('#playPauseButton');
const playIcon = document.querySelector('#playIcon');
const playLabel = document.querySelector('#playLabel');
const stopButton = document.querySelector('#stopButton');
const progress = document.querySelector('#progress');
const currentTime = document.querySelector('#currentTime');
const totalTime = document.querySelector('#totalTime');
const status = document.querySelector('#status');
const songInfo = document.querySelector('#songInfo');
const tracks = document.querySelector('#tracks');
const speed = document.querySelector('#speed');
const speedValue = document.querySelector('#speedValue');
const scoreElement = document.querySelector('#alphaTab');
const showAllButton = document.querySelector('#showAllButton');
const soundLibrary = document.querySelector('#soundLibrary');
const soundfontInput = document.querySelector('#soundfontInput');

let currentScore = null;
let visibleTrackIndexes = [];
let isSeeking = false;
let isPlaying = false;
let hasMidi = false;
let playerError = null;
const trackState = new Map();
let importedTrackNames = [];
let selectedMeasure = null;
let pendingSeekTick = null;
const assetBase = window.location.protocol === 'file:' ? './' : '/';
const soundLibraries = {
  musescore: {
    label: 'MuseScore General',
    source: `${assetBase}soundfont/MuseScore_General.sf3`,
  },
  sonivox: {
    label: 'Sonivox',
    source: `${assetBase}soundfont/sonivox.sf2`,
  },
};
const instrumentProfiles = [
  { id: 'source', label: 'Из файла GP', program: null },
  { id: 'electric-clean', label: 'Электрогитара Clean', program: 27 },
  { id: 'electric-drive', label: 'Электрогитара Drive', program: 30 },
  { id: 'acoustic-steel', label: 'Акустика Steel', program: 25 },
  { id: 'bass-finger', label: 'Бас Finger', program: 33 },
  { id: 'bass-pick', label: 'Бас Pick', program: 34 },
];
const drumProfiles = [
  { id: 'source', label: 'Из файла GP', program: null },
  { id: 'drums-standard', label: 'Барабаны Standard', program: 0 },
];
let activeSoundLibrary = 'musescore';
let activeSoundLibraryLabel = soundLibraries[activeSoundLibrary].label;

const api = new alphaTab.AlphaTabApi(scoreElement, {
  core: {
    fontDirectory: `${assetBase}font/`,
  },
  importer: {
    encoding: 'utf-8',
  },
  player: {
    enablePlayer: true,
    enableCursor: true,
    enableUserInteraction: true,
    soundFont: soundLibraries.musescore.source,
    scrollElement: '.scorePanel',
  },
  display: {
    scale: 0.92,
    staveProfile: alphaTab.StaveProfile.ScoreTab,
  },
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    await loadScoreData(await file.arrayBuffer(), file.name);
  } catch (error) {
    showError(error);
  }
});

window.desktopApi?.onOpenScoreFile(async ({ name, data }) => {
  try {
    await loadScoreData(data, name);
  } catch (error) {
    showError(error);
  }
});

async function loadScoreData(data, fileName) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  setStatus(`Открываю ${fileName}...`);
  setPlayerEnabled(false);
  hasMidi = false;
  playerError = null;
  importedTrackNames = [];
  selectedMeasure = null;
  pendingSeekTick = null;
  visibleTrackIndexes = [];
  trackState.clear();

  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 30));
  // GP3-GP5 stores text in the active Windows code page, unlike GP6/GP7.
  const isLegacyGp = header.includes('FICHIER GUITAR PRO ');
  api.settings.importer.encoding = isLegacyGp ? 'windows-1251' : 'utf-8';
  if (isLegacyGp) importedTrackNames = extractLegacyGpTrackNames(bytes);
  api.load(bytes);
}

playPauseButton.addEventListener('click', () => {
  if (isPlaying) api.pause();
  else api.play();
});

stopButton.addEventListener('click', () => {
  api.stop();
  progress.value = '0';
  currentTime.textContent = '0:00';
});

progress.addEventListener('input', () => {
  isSeeking = true;
});

progress.addEventListener('change', () => {
  isSeeking = false;
  api.tickPosition = Number(progress.value);
});

speed.addEventListener('input', () => {
  const value = Number(speed.value);
  speedValue.textContent = `${value}%`;
  api.playbackSpeed = value / 100;
});

soundLibrary.addEventListener('change', () => {
  const libraryId = soundLibrary.value;
  if (libraryId === 'custom') {
    soundfontInput.click();
    return;
  }

  loadBuiltInSoundLibrary(libraryId);
});

soundfontInput.addEventListener('change', async () => {
  const file = soundfontInput.files?.[0];
  if (!file) {
    soundLibrary.value = activeSoundLibrary;
    return;
  }

  try {
    activeSoundLibrary = 'custom';
    activeSoundLibraryLabel = file.name;
    soundLibrary.value = 'custom';
    loadSoundFont(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    showError(error);
  }
});

showAllButton.addEventListener('click', () => {
  const score = getActiveScore();
  if (!score) return;
  visibleTrackIndexes = score.tracks.map((track) => track.index);
  renderNotation();
  renderTracks(score);
});

api.scoreLoaded.on((score) => {
  const isNewScore = score !== currentScore;
  currentScore = score;

  if (!isNewScore) return;

  visibleTrackIndexes = score.tracks.map((track) => track.index);
  trackState.clear();
  score.tracks.forEach((track) => {
    const importedName = importedTrackNames[track.index];
    if (importedName) track.name = importedName;
    const balance = track.playbackInfo?.balance ?? 8;
    trackState.set(track.index, {
      mute: false,
      solo: false,
      volume: 1,
      pan: Math.round((balance / 16) * 200 - 100),
      sourceProgram: track.playbackInfo?.program ?? 0,
      instrumentId: 'source',
    });
  });
  updateSongInfo(score);
  setStatus('Файл открыт. Готовлю звук для проигрывания...');
  scheduleMixerRender(score);
});

api.renderStarted.on(() => setStatus('Рисую ноты...'));
api.renderFinished.on(() => {
  if (!playerError) setStatus('Ноты готовы. Готовлю звук...');
});

api.playerReady.on(() => {
  setPlayerEnabled(true);
  setStatus('Плеер готов.');
});

api.soundFontLoaded.on(() => {
  if (currentScore) api.loadMidiForScore();
  setStatus(`Библиотека «${activeSoundLibraryLabel}» готова.`);
});

api.midiLoaded.on((args) => {
  hasMidi = true;
  setPlayerEnabled(true);
  progress.max = String(args.endTick);
  totalTime.textContent = formatTime(args.endTime);
  requestAnimationFrame(() => {
    applyTrackPlaybackState();
    applyPendingSeek();
  });
});

api.playerPositionChanged.on((args) => {
  if (!isSeeking) progress.value = String(args.currentTick);
  currentTime.textContent = formatTime(args.currentTime);
  totalTime.textContent = formatTime(args.endTime);
});

api.playerStateChanged.on((args) => {
  isPlaying = args.state === alphaTab.synth.PlayerState.Playing;
  playIcon.textContent = isPlaying ? 'Pause' : 'Play';
  playLabel.textContent = isPlaying ? 'Пауза' : 'Играть';
});

api.error.on(showError);

function renderTracks(score) {
  if (!score) return;
  tracks.classList.remove('tracksEmpty');
  tracks.innerHTML = '';
  showAllButton.disabled = false;

  const mixerHeader = document.createElement('div');
  mixerHeader.className = 'mixerHeader';
  mixerHeader.innerHTML = `
    <span>Ноты</span>
    <span>Дорожка</span>
    <span>Звук</span>
    <span>M</span>
    <span>S</span>
    <span>Громкость</span>
    <span>Панорама</span>
    <span>Такты</span>
  `;
  tracks.append(mixerHeader);

  score.tracks.forEach((track) => {
    const state = trackState.get(track.index);
    const item = document.createElement('article');
    item.className = 'trackItem';
    item.style.setProperty('--track-color', getTrackColor(track.index));

    const visible = document.createElement('input');
    visible.type = 'checkbox';
    visible.checked = visibleTrackIndexes.includes(track.index);
    visible.title = 'Показывать ноты дорожки';
    visible.addEventListener('change', () => toggleTrackVisibility(track.index, visible.checked));

    const name = document.createElement('span');
    name.className = 'trackName';
    name.title = readableTrackName(track);
    name.textContent = readableTrackName(track);

    const instrument = createInstrumentControl(track, state);

    const solo = document.createElement('button');
    solo.type = 'button';
    solo.className = `trackModeButton ${state.solo ? 'isActive' : ''}`;
    solo.textContent = 'S';
    solo.title = 'Играть только эту дорожку';
    solo.setAttribute('aria-pressed', String(state.solo));
    solo.addEventListener('click', () => setTrackSolo(track, !state.solo));

    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = `trackModeButton ${state.mute ? 'isMuted' : ''}`;
    mute.textContent = 'M';
    mute.title = 'Выключить звук дорожки';
    mute.setAttribute('aria-pressed', String(state.mute));
    mute.addEventListener('click', () => setTrackMute(track, !state.mute));

    const volumeRow = document.createElement('label');
    volumeRow.className = 'mixerControl';
    volumeRow.title = 'Громкость дорожки';
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '150';
    volume.value = String(Math.round(state.volume * 100));
    const volumeValue = document.createElement('output');
    volumeValue.textContent = `${volume.value}%`;
    volume.addEventListener('input', () => {
      const value = Number(volume.value) / 100;
      state.volume = value;
      volumeValue.textContent = `${volume.value}%`;
      api.changeTrackVolume([track], value);
    });
    volumeRow.append(volume, volumeValue);

    const panRow = document.createElement('label');
    panRow.className = 'mixerControl panControl';
    panRow.title = 'Панорама дорожки';
    const pan = document.createElement('input');
    pan.type = 'range';
    pan.min = '-100';
    pan.max = '100';
    pan.value = String(state.pan);
    const panValue = document.createElement('output');
    panValue.textContent = formatPan(state.pan);
    pan.addEventListener('input', () => {
      state.pan = Number(pan.value);
      panValue.textContent = formatPan(state.pan);
    });
    pan.addEventListener('change', () => {
      if (!track.playbackInfo) return;
      track.playbackInfo.balance = Math.round(((state.pan + 100) / 200) * 16);
      api.loadMidiForScore();
    });
    panRow.append(pan, panValue);

    const timeline = createTrackTimeline(score, track.index);

    item.append(visible, name, instrument, mute, solo, volumeRow, panRow, timeline);
    tracks.append(item);
  });

  tracks.append(createMasterRow());
}

function createInstrumentControl(track, state) {
  const select = document.createElement('select');
  select.className = 'instrumentSelect';
  select.title = 'Выбрать сэмпл-инструмент для дорожки';

  const profiles = track.isPercussion ? drumProfiles : instrumentProfiles;
  profiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.label;
    select.append(option);
  });
  select.value = state.instrumentId;
  select.addEventListener('change', () => applyInstrumentProfile(track, select.value));
  return select;
}

function applyInstrumentProfile(track, instrumentId) {
  const state = trackState.get(track.index);
  if (!state || !track.playbackInfo) return;

  const profiles = track.isPercussion ? drumProfiles : instrumentProfiles;
  const profile = profiles.find((candidate) => candidate.id === instrumentId);
  if (!profile) return;

  state.instrumentId = profile.id;
  track.playbackInfo.program = profile.program ?? state.sourceProgram;
  api.loadMidiForScore();
  setStatus(`Звук дорожки «${readableTrackName(track)}» изменён.`);
}

function loadBuiltInSoundLibrary(libraryId) {
  const library = soundLibraries[libraryId];
  if (!library) return;

  activeSoundLibrary = libraryId;
  activeSoundLibraryLabel = library.label;
  soundLibrary.value = libraryId;
  loadSoundFont(library.source);
}

function loadSoundFont(source) {
  if (isPlaying) api.stop();
  setPlayerEnabled(false);
  setStatus(`Загружаю библиотеку «${activeSoundLibraryLabel}»...`);
  api.resetSoundFonts();
  api.loadSoundFont(source, false);
}

function applyTrackPlaybackState() {
  const score = getActiveScore();
  if (!score) return;

  score.tracks.forEach((track) => {
    const state = trackState.get(track.index);
    if (!state) return;
    api.changeTrackMute([track], state.mute);
    api.changeTrackSolo([track], state.solo);
    api.changeTrackVolume([track], state.volume);
  });
}

function scheduleMixerRender(score) {
  setTimeout(() => {
    try {
      renderTracks(score);
    } catch (error) {
      console.error('Не удалось отрисовать микшер', error);
    }
  }, 0);
}

function createTrackTimeline(score, trackIndex) {
  const timeline = document.createElement('div');
  const measureCount = score.masterBars?.length || 1;
  timeline.className = 'trackTimeline';
  timeline.style.setProperty('--measure-count', String(measureCount));
  timeline.title = `Дорожка ${trackIndex + 1}: ${score.masterBars?.length || 0} тактов`;

  for (let measure = 0; measure < measureCount; measure += 1) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'measureCell';
    cell.title = `${readableTrackName(score.tracks[trackIndex])}, такт ${measure + 1}`;
    cell.setAttribute('aria-label', cell.title);
    if (selectedMeasure?.trackIndex === trackIndex && selectedMeasure.measureIndex === measure) {
      cell.classList.add('isSelected');
    }
    if (measure % 4 === 0) cell.dataset.marker = String(measure + 1);
    cell.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      selectTrackMeasure(score, trackIndex, measure);
    });
    cell.addEventListener('click', (event) => {
      if (event.detail === 0) selectTrackMeasure(score, trackIndex, measure);
    });
    timeline.append(cell);
  }
  return timeline;
}

function selectTrackMeasure(score, trackIndex, measureIndex) {
  const track = score.tracks.find((candidate) => candidate.index === trackIndex);
  const masterBar = score.masterBars?.[measureIndex];
  if (!track || !masterBar) return;

  selectedMeasure = { trackIndex, measureIndex };
  visibleTrackIndexes = [trackIndex];
  pendingSeekTick = api.tickCache?.getMasterBarStart(masterBar) ?? masterBar.start ?? 0;

  renderNotation();
  seekToTick(pendingSeekTick);
  renderTracks(score);
  setStatus(`Дорожка «${readableTrackName(track)}», такт ${measureIndex + 1}.`);
}

function seekToTick(tick) {
  const targetTick = Math.max(0, Math.round(tick || 0));
  api.tickPosition = targetTick;
  progress.value = String(targetTick);
  pendingSeekTick = null;
}

function applyPendingSeek() {
  if (pendingSeekTick === null) return;
  seekToTick(pendingSeekTick);
}

function createMasterRow() {
  const row = document.createElement('div');
  row.className = 'masterMixRow';
  const label = document.createElement('strong');
  label.textContent = 'Master';
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '150';
  volume.value = String(Math.round(api.masterVolume * 100));
  const value = document.createElement('output');
  value.textContent = `${volume.value}%`;
  volume.addEventListener('input', () => {
    api.masterVolume = Number(volume.value) / 100;
    value.textContent = `${volume.value}%`;
  });
  row.append(label, volume, value);
  return row;
}

function readableTrackName(track) {
  const name = String(track.name || '').trim();
  if (!name || name.includes('\ufffd')) return `Дорожка ${track.index + 1}`;
  return name;
}

function extractLegacyGpTrackNames(data) {
  const names = [];
  const decoder = new TextDecoder('windows-1251');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const scanLimit = Math.min(data.length - 93, 128000);

  for (let offset = 0; offset <= scanLimit; offset += 1) {
    const nameLength = data[offset];
    if (nameLength < 1 || nameLength > 40) continue;

    const stringCount = view.getInt32(offset + 41, true);
    const port = view.getInt32(offset + 73, true);
    const channel = view.getInt32(offset + 77, true);
    const effectChannel = view.getInt32(offset + 81, true);
    if (stringCount < 1 || stringCount > 7 || port < 1 || port > 4 || channel < 1 || channel > 64 || effectChannel < 1 || effectChannel > 64) continue;

    let hasValidTunings = true;
    for (let stringIndex = 0; stringIndex < 7; stringIndex += 1) {
      const tuning = view.getInt32(offset + 45 + stringIndex * 4, true);
      if (tuning < -1 || tuning > 127) {
        hasValidTunings = false;
        break;
      }
    }
    if (!hasValidTunings) continue;

    const name = decoder
      .decode(data.subarray(offset + 1, offset + 1 + nameLength))
      .replace(/[\0-\x1f]/g, '')
      .trim();
    if (name) names.push(name);
  }

  return names;
}

function getTrackColor(trackIndex) {
  const colors = ['#73c6de', '#f39b7d', '#f2d77b', '#8ecf8c', '#be93e4', '#e77fb3'];
  return colors[trackIndex % colors.length];
}

function formatPan(value) {
  if (value === 0) return 'C';
  return value < 0 ? `L${Math.abs(value)}` : `R${value}`;
}

function toggleTrackVisibility(trackIndex, visible) {
  if (visible) {
    visibleTrackIndexes = [...new Set([...visibleTrackIndexes, trackIndex])].sort((a, b) => a - b);
  } else {
    visibleTrackIndexes = visibleTrackIndexes.filter((index) => index !== trackIndex);
  }

  renderNotation();
  renderTracks(getActiveScore());
}

function renderNotation() {
  const score = getActiveScore();
  if (!score) return;
  const selectedTracks = score.tracks.filter((track) => visibleTrackIndexes.includes(track.index));
  if (selectedTracks.length) api.renderTracks(selectedTracks);
  else scoreElement.innerHTML = '<div class="emptyNotation">Выберите хотя бы одну дорожку, чтобы увидеть ноты.</div>';
}

function setTrackMute(track, mute) {
  const state = trackState.get(track.index);
  state.mute = mute;
  api.changeTrackMute([track], mute);
  renderTracks(getActiveScore());
}

function setTrackSolo(track, solo) {
  const state = trackState.get(track.index);
  state.solo = solo;
  api.changeTrackSolo([track], solo);
  renderTracks(getActiveScore());
}

function getActiveScore() {
  return api.score || currentScore;
}

function updateSongInfo(score) {
  const title = score.title || 'Без названия';
  const artist = score.artist || score.album || '';
  songInfo.textContent = artist ? `${title} - ${artist}` : title;
}

function setStatus(message) {
  status.textContent = message;
  status.classList.remove('error');
}

function showError(error) {
  console.error(error);
  playerError = error;
  status.textContent = `Не удалось открыть файл: ${error?.message || error}`;
  status.classList.add('error');
  setPlayerEnabled(false);
}

function setPlayerEnabled(enabled) {
  playPauseButton.disabled = !enabled;
  stopButton.disabled = !enabled;
  progress.disabled = !enabled;
}

function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor((milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
