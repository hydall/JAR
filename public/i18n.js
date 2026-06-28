'use strict';

const I18N = {
  en: {
    login: 'log in',
    howBtn: 'how it works',
    settingsBtn: 'settings',
    captures: 'captures',
    charUrlPh: 'paste character URL…',
    runBtn: 'extract',
    emptyHint: 'paste a character URL and click <b>extract</b> to capture the character card and lorebook entries.',
    detailEmpty: 'select a capture on the left.',
    deleteBtn: 'delete',
    rawMsgSummary: 'raw messages (<span id="msgCount">0</span>)',
    rawJsonToggle: 'raw JSON (exactly as received from generateAlpha)',
    tabCard: 'character card',
    tabLorebook: 'lorebook',
    noAvatar: 'no avatar',
    lblName: 'name',
    phCharName: 'character name…',
    lblDesc: 'description / persona',
    lblPersonality: 'personality',
    lblScenario: 'scenario',
    lblFirst: 'first message',
    lblAltGreetings: 'alternate greetings',
    cardSrcJanitor: '✓ pulled directly from JanitorAI (open definition) — exact, no reconstruction',
    cardSrcReconstructed: '⚠ reconstructed from the prompt (definition is hidden)',
    lblExample: 'example messages',
    lblTags: 'tags (comma-separated)',
    lblNotes: 'creator notes',
    dlImgBtn: 'image only',
    lblLorebook: 'isolated lorebook text (editable)',
    phLorebook: 'populated after capture…',
    dlRawBtn: 'download raw (no keys)',
    buildTitle: 'build with LLM',
    lblContext: 'context sent for key inference (never output as entries)',
    ctxCard: 'character card',
    ctxCatalog: 'card description on site',
    ctxScenario: 'scenario',
    ctxGreetings: 'first message(s)',
    ctxLorebookDescs: 'lorebook descriptions',
    ctxExtra: 'custom text',
    phExtra: 'optional custom context…',
    lblWorldName: 'world info name (optional)',
    buildBtn: 'build lorebook',
    previewBtn: 'preview prompt',
    promptPreviewTitle: 'prompt sent to the build LLM',
    cardPrivateHint: 'this card is private — click Extract to reconstruct it from the prompt.',
    btnExtractCard: 'extract card',
    loreExtractTitle: 'extract closed lorebook',
    loreExtractHint: 'choose what context is sent to the model to retrieve the lorebook entries.',
    btnExtractLore: 'extract',
    publicTitle: 'public lorebooks',
    publicHintOnly: 'public, downloaded whole from JanitorAI — no extraction needed.',
    publicHint: 'character has public lorebooks. those has been downloaded whole from JanitorAI — no extraction needed. their entries are automatically removed from the extracted closed lorebook below.',
    publicUntitled: '(untitled lorebook)',
    privateTitle: 'private lorebooks',
    privateHint: 'This character has {n} closed lorebooks which need to be extracted. They will be merged into a single lorebook due to limitations of the extraction method.',
    private: 'private',
    closedMergeHint: 'This character has {n} closed lorebooks. They will be merged into a single lorebook due to limitations of the extraction method.',
    closedAlso: 'This character also has closed lorebooks. {merge}Here are the entries that could be extracted:',
    noLorebook: 'this character has no lorebook',
    settingsTitle: 'extraction LLM (OpenAI-compatible)',
    lblLanguage: 'language',
    cancelBtn: 'cancel',
    saveBtn: 'save',
    gotIt: 'got it',
    llmNotConfigured: 'set up the extraction LLM in settings first',

    // dynamic strings used in app.js
    extracting: 'extracting…',
    inspecting: 'inspecting…',
    inspectDone: 'inspected — extract the card / lorebook on demand',
    buildStillRunning: 'still running, the model may be slow…',
    buildFailed: 'failed',
    checkingSession: 'checking session…',
    loggedIn: 'logged in',
    notLoggedIn: 'not logged in',
    notSignedIn: 'not signed in - try again',
    openingJanitor: 'opening JanitorAI - sign in in the browser window…',
    capturedReview: 'captured - review the entries, then build',
    pasteFirst: 'paste a character URL first',
    creatingChat: 'creating chat & triggering…',
    building: 'building…',
    noAvatarEmbed: 'no avatar to embed',
    buildingPng: 'building PNG…',
    noAvatarAvail: 'no avatar available',
    nameRequired: 'name is required',
    jsonDl: 'JSON downloaded',
    pngDl: 'PNG downloaded',
    imgDl: 'image downloaded',
    deleteConfirm: 'delete this capture?',
    loading: 'loading…',

    // extraction breakdown (provenance)
    provTitle: 'extraction breakdown',
    provLorebookLbl: 'lorebook',
    provEntry: 'entry',
    provSegmentsLbl: 'prompt segments',
    provNothing: 'nothing was stripped — the whole system prompt is treated as lorebook. no <…Persona> wrappers were found, so the character card may be leaking in. check the source: it should be generateAlpha, not a proxy request.',
    provEntries: 'entries',
    provChars: 'chars',
    charLabel: 'character',
    actionOr: 'OR',
    rmJailbreak: 'jailbreak / system prefix',
    rmCard: 'character card (persona)',
    rmUserPersona: 'user persona',
    rmScenario: 'scenario',
    rmExample: 'example dialogue',
    rmKnownCard: 'pasted card lines',
    rmPublicLorebook: 'public lorebook (downloaded separately)',

    howTitle: 'how it works',
    howIntro: 'Janitor uses Cloudflare to protect against bots and automation. JAR launches a full browser window that passes through Cloudflare and executes all requests from there.',
    howCardTitle: 'character card extraction',
    howCardText: 'JAR creates and selects a dummy proxy preset, sends a message in the chat, and intercepts the generateAlpha response — the assembled prompt that contains the character card wrapped in tags.',
    howLoreTitle: 'closed lorebook extraction',
    howLoreText: 'closed lorebooks are processed on the Janitor server. it is impossible to fully extract lorebooks in their original form. as a workaround, JAR sends the character card, the catalog description and the first message into the chat. this text goes to the Janitor server, where it triggers lorebook entries. the server injects those entries into the prompt. JAR intercepts the generateAlpha response and isolates the lorebook entries, discarding everything else.',
    howAfter: 'after that you can do two things:',
    howLi1: 'download a raw lorebook without keys or rules.',
    howLi2: 'send the entries to a chosen model (along with the character card and description for context) and have it build a proper lorebook for you.',
    howUniverse: 'if the target character uses a generic lorebook (e.g. a universe lorebook or a sex-positions lorebook), this method may not trigger all entries automatically. the only way to pull them is to manually type the keys during entry collection. those keys can then be sent during the LLM build for additional context.',
  },

  ru: {
    login: 'войти',
    howBtn: 'как это работает',
    settingsBtn: 'настройки',
    captures: 'захваты',
    charUrlPh: 'вставьте ссылку на персонажа…',
    runBtn: 'извлечь',
    emptyHint: 'вставьте ссылку на персонажа и нажмите <b>извлечь</b> чтобы захватить карточку персонажа и записи лорбука.',
    detailEmpty: 'выберите захват слева.',
    deleteBtn: 'удалить',
    rawMsgSummary: 'сырые сообщения (<span id="msgCount">0</span>)',
    rawJsonToggle: 'сырой JSON (ровно как пришло от generateAlpha)',
    tabCard: 'карточка персонажа',
    tabLorebook: 'лорбук',
    noAvatar: 'нет аватарки',
    lblName: 'имя',
    phCharName: 'имя персонажа…',
    lblDesc: 'описание / персона',
    lblPersonality: 'личность',
    lblScenario: 'сценарий',
    lblFirst: 'первое сообщение',
    lblAltGreetings: 'альтернативные приветствия',
    cardSrcJanitor: '✓ взято напрямую из JanitorAI (открытое определение) — точно, без реконструкции',
    cardSrcReconstructed: '⚠ реконструировано из промпта (определение скрыто)',
    lblExample: 'примеры сообщений',
    lblTags: 'теги (через запятую)',
    lblNotes: 'заметки создателя',
    dlImgBtn: 'только картинка',
    lblLorebook: 'изолированный текст лорбука (редактируемый)',
    phLorebook: 'заполнится после захвата…',
    dlRawBtn: 'скачать сырой (без ключей)',
    buildTitle: 'сборка через LLM',
    lblContext: 'контекст для подбора ключей (не попадает в записи)',
    ctxCard: 'карточка персонажа',
    ctxCatalog: 'описание карточки на сайте',
    ctxScenario: 'сценарий',
    ctxGreetings: 'первые сообщения',
    ctxLorebookDescs: 'описания лорбуков',
    ctxExtra: 'свой текст',
    phExtra: 'опциональный контекст…',
    lblWorldName: 'имя world info (опционально)',
    buildBtn: 'собрать лорбук',
    previewBtn: 'предпросмотр промпта',
    promptPreviewTitle: 'промпт, отправленный сборщику',
    cardPrivateHint: 'карточка приватная — нажмите «Извлечь», чтобы реконструировать её из промпта.',
    btnExtractCard: 'извлечь карточку',
    loreExtractTitle: 'извлечь закрытый лорбук',
    loreExtractHint: 'выберите, какой контекст отправить модели для получения записей лорбука.',
    btnExtractLore: 'извлечь',
    publicTitle: 'публичные лорбуки',
    publicHintOnly: 'публичные, скачаны целиком с JanitorAI — экстракция не нужна.',
    publicHint: 'у персонажа есть публичные лорбуки. они скачаны целиком с JanitorAI — экстракция не нужна. их записи автоматически убраны из извлечённого закрытого лорбука ниже.',
    publicUntitled: '(лорбук без названия)',
    privateTitle: 'приватные лорбуки',
    privateHint: 'У персонажа {n} закрытых лорбуков, которые нужно извлечь. Они будут объединены в один лорбук ввиду ограничений способа экстракции.',
    private: 'приватный',
    closedMergeHint: 'У персонажа {n} закрытых лорбуков. Они будут объединены в один лорбук ввиду ограничений способа экстракции.',
    closedAlso: 'У персонажа также есть закрытые лорбуки. {merge}Вот записи, которые удалось извлечь:',
    noLorebook: 'у персонажа нет лорбука',
    settingsTitle: 'LLM для экстракции (OpenAI-совместимый)',
    lblLanguage: 'язык',
    cancelBtn: 'отмена',
    saveBtn: 'сохранить',
    gotIt: 'понятно',
    llmNotConfigured: 'сначала настройте LLM для экстракции в настройках',

    extracting: 'извлечение…',
    checkingSession: 'проверка сессии…',
    loggedIn: 'вошли',
    notLoggedIn: 'не авторизован',
    notSignedIn: 'не вошли - попробуйте снова',
    openingJanitor: 'открываю JanitorAI - войдите в окне браузера…',
    capturedReview: 'захвачено - проверьте записи, затем собрать',
    pasteFirst: 'сначала вставьте ссылку на персонажа',
    creatingChat: 'создаю чат и триггерю…',
    building: 'сборка…',
    noAvatarEmbed: 'нет аватарки для встраивания',
    buildingPng: 'сборка PNG…',
    noAvatarAvail: 'аватарка недоступна',
    nameRequired: 'имя обязательно',
    jsonDl: 'JSON скачан',
    pngDl: 'PNG скачан',
    imgDl: 'картинка скачана',
    deleteConfirm: 'удалить этот захват?',
    loading: 'загрузка…',

    // разбор извлечения
    provTitle: 'разбор извлечения',
    provLorebookLbl: 'лорбук',
    provEntry: 'запись',
    provSegmentsLbl: 'сегменты промпта',
    provNothing: 'ничего не вырезано — весь системный промпт идёт в лорбук. теги <…Persona> не найдены, поэтому карточка персонажа могла протечь внутрь. проверь источник: должен быть generateAlpha, а не запрос к прокси.',
    provEntries: 'записей',
    provChars: 'симв.',
    charLabel: 'персонаж',
    actionOr: 'ИЛИ',
    rmJailbreak: 'джейлбрейк / системный префикс',
    rmCard: 'карточка персонажа (персона)',
    rmUserPersona: 'персона юзера',
    rmScenario: 'сценарий',
    rmExample: 'примеры диалогов',
    rmKnownCard: 'строки вставленной карточки',
    rmPublicLorebook: 'публичный лорбук (скачан отдельно)',

    howTitle: 'как это работает',
    howIntro: 'Janitor использует Cloudflare для защиты от ботов и автоматизации. JAR запускает полноценное браузерное окно, которое проходит через Cloudflare, и выполняет все запросы.',
    howCardTitle: 'экстракция карточки персонажа',
    howCardText: 'JAR создаёт и выбирает dummy proxy пресет, отправляет сообщение в чате и перехватывает ответ generateAlpha — собранный промпт, содержащий карточку персонажа в тегах.',
    howLoreTitle: 'экстракция закрытых лорбуков',
    howLoreText: 'закрытые лорбуки обрабатываются на сервере Janitor. полноценно вытащить лорбуки в их исходном виде — невозможно. в качестве обходного пути JAR отправляет в чат карточку персонажа, его описание из каталога и первое сообщение. этот текст уходит на сервер Janitor, где вызывает записи лорбуков. сервер вставляет эти записи в промпт. JAR перехватывает ответ generateAlpha и вычленяет из него записи лорбуков, отметая всё лишнее.',
    howAfter: 'после этого вы можете сделать две вещи:',
    howLi1: 'скачать голый лорбук без ключей и правил.',
    howLi2: 'отправить эти записи выбранной модели (вместе с карточкой персонажа и её описанием для контекста) и попросить её собрать лорбук вместо вас.',
    howUniverse: 'если целевой персонаж использует какой-то общий лорбук (например, лорбук вселенной или лорбук для поз в сексе), то этот метод может не вызвать все записи автоматически. единственный способ их вытащить — самостоятельно вписать ключи при сборе записей. эти ключи потом могут быть отправлены при сборке с помощью LLM для дополнительного контекста.',
  },
};

let currentLang = 'en';
const LANG_STORAGE_KEY = 'jar_lang';

function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && I18N[saved]) return saved;
  } catch (_) { /* localStorage unavailable */ }
  const nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  return nav.startsWith('ru') ? 'ru' : 'en';
}

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });

  // how dialog
  function renderHow(lang) {
    const d = I18N[lang];
    return `<h2>${d.howTitle}</h2>
      <p>${d.howIntro}</p>
      <h3>${d.howCardTitle}</h3>
      <p>${d.howCardText}</p>
      <h3>${d.howLoreTitle}</h3>
      <p>${d.howLoreText}</p>
      <p>${d.howAfter}</p>
      <ul><li>${d.howLi1}</li><li>${d.howLi2}</li></ul>
      <p>${d.howUniverse}</p>`;
  }
  const howEN = document.getElementById('howEN');
  const howRU = document.getElementById('howRU');
  if (howEN) howEN.innerHTML = renderHow('en');
  if (howRU) howRU.innerHTML = renderHow('ru');
  if (howEN) howEN.classList.toggle('hidden', currentLang !== 'en');
  if (howRU) howRU.classList.toggle('hidden', currentLang !== 'ru');
}

function setLang(lang, persist) {
  if (!I18N[lang]) lang = 'en';
  currentLang = lang;
  document.documentElement.lang = lang;
  if (persist) {
    try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch (_) { /* ignore */ }
  }
  applyI18n();
}

setLang(detectLang());
