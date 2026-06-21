const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];
const SUIT_LABEL = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' };
const SUIT_NAME = { spades: '黑桃', hearts: '红桃', clubs: '梅花', diamonds: '方块' };
const SUIT_EFFECTS = {
  spades: '永久削减当前 Boss 攻击力',
  hearts: '从弃牌堆回收卡牌到抽牌堆底',
  clubs: '本次造成的伤害翻倍',
  diamonds: '从出牌者开始轮流抽牌',
};
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const BOSS_RANKS = ['J', 'Q', 'K'];
const app = document.querySelector('#app');

let state = newGame(4);

function makeId() {
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newGame(playerCount) {
  const drawPile = shuffle(createBasicDeck());
  const players = Array.from({ length: playerCount }, (_, index) => ({
    name: `玩家 ${index + 1}`,
    hand: [],
    alive: true,
  }));

  if (playerCount === 5) {
    for (let i = 0; i < 2; i += 1) {
      drawPile.splice(Math.floor(Math.random() * drawPile.length), 0, {
        id: `skill-${makeId()}`,
        suit: 'diamonds',
        rank: 'Skill',
        value: 0,
        kind: 'skill',
      });
    }
  }

  const game = {
    phase: 'play',
    playerCount,
    players,
    currentPlayer: 0,
    selectedHandIds: new Set(),
    selectedHandOrder: [],
    selectedDefenseIds: new Set(),
    selectedDefenseOrder: [],
    drawPile,
    discardPile: [],
    extraZone: [],
    bossDeck: createBossDeck(),
    currentBoss: null,
    logs: [],
    message: '',
    pendingSkill: false,
  };

  game.currentBoss = game.bossDeck.shift();
  refillAllHands(game);
  pushLog(game, `${playerCount} 人局开始，${bossName(game.currentBoss)} 登场。`);
  game.message = `${game.players[0].name} 的回合。`;
  return game;
}

function createBasicDeck() {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${suit}-${rank}-${makeId()}`,
      suit,
      rank,
      value: rank === 'A' ? 1 : Number(rank),
      kind: 'basic',
    })),
  );
}

function createBossDeck() {
  return BOSS_RANKS.flatMap((rank) => {
    const stats = rank === 'J' ? [10, 20] : rank === 'Q' ? [15, 30] : [20, 40];
    return shuffle(SUITS).map((suit) => ({
      id: `boss-${suit}-${rank}`,
      suit,
      rank,
      value: stats[1],
      kind: 'boss',
      attackBase: stats[0],
      attack: stats[0],
      maxHp: stats[1],
      hp: stats[1],
      suitDisabled: false,
    }));
  });
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function handLimit(game = state) {
  return game.playerCount === 4 ? 5 : 4;
}

function refillAllHands(game) {
  game.players.forEach((player) => {
    while (player.hand.length < handLimit(game) && game.drawPile.length > 0) {
      player.hand.push(game.drawPile.shift());
    }
  });
}

function currentPlayer() {
  return state.players[state.currentPlayer];
}

function bossName(boss) {
  return boss ? `${SUIT_NAME[boss.suit]}${SUIT_LABEL[boss.suit]} ${boss.rank}` : '无 Boss';
}

function pushLog(game, text) {
  game.logs.unshift(text);
  game.logs = game.logs.slice(0, 16);
}

function selectedPlayCards() {
  const handById = new Map(currentPlayer().hand.map((card) => [card.id, card]));
  return state.selectedHandOrder.map((id) => handById.get(id)).filter(Boolean);
}

function selectedDefenseCards() {
  const handById = new Map(currentPlayer().hand.map((card) => [card.id, card]));
  return state.selectedDefenseOrder.map((id) => handById.get(id)).filter(Boolean);
}

function validatePlay(cards) {
  if (cards.length === 0) return '请选择要出的手牌。';
  if (cards.length === 1) return null;
  if (cards.some((card) => card.kind === 'skill')) return cards.length === 1 ? null : '技能卡需要单独使用。';
  if (cards.length === 2) {
    const hasAce = cards.some((card) => card.rank === 'A');
    const sameRank = cards[0].rank === cards[1].rank;
    const total = cards.reduce((sum, card) => sum + card.value, 0);
    if (hasAce || (sameRank && total <= 10)) return null;
  }
  return '只能出单张、点数和不超过 10 的对子，或 A 加任意一张。';
}

function projectTurn(cards, boss) {
  if (!boss || cards.length === 0 || cards.some((card) => card.kind === 'skill')) {
    return {
      rawDamage: 0,
      damage: 0,
      projectedHp: boss ? boss.hp : 0,
      enabledCards: [],
      enabledSuits: [],
      blockedSuits: [],
    };
  }

  const rawDamage = cards.reduce((sum, card) => sum + card.value, 0);
  const enabledCards = cards.filter((card) => boss.suitDisabled || card.suit !== boss.suit);
  const enabledSuits = [...new Set(enabledCards.map((card) => card.suit))];
  const blockedSuits = [...new Set(cards.filter((card) => !boss.suitDisabled && card.suit === boss.suit).map((card) => card.suit))];
  let damage = rawDamage;

  if (enabledSuits.includes('clubs')) {
    damage *= 2;
  }

  return {
    rawDamage,
    damage,
    projectedHp: Math.max(0, boss.hp - damage),
    enabledCards,
    enabledSuits,
    blockedSuits,
  };
}

function playSelected() {
  const boss = state.currentBoss;
  if (!boss || state.phase !== 'play') return;

  const cards = selectedPlayCards();
  const validation = validatePlay(cards);
  if (validation) {
    state.message = validation;
    render();
    return;
  }

  const player = currentPlayer();
  player.hand = player.hand.filter((card) => !state.selectedHandIds.has(card.id));
  state.selectedHandIds.clear();
  state.selectedHandOrder = [];

  if (cards[0].kind === 'skill') {
    state.discardPile.push(cards[0]);
    boss.suitDisabled = true;
    state.pendingSkill = true;
    state.phase = 'target-player';
    state.message = '技能卡已生效，请指定下一名玩家。';
    pushLog(state, `${player.name} 使用技能卡，${bossName(boss)} 的花色压制被无效。`);
    render();
    return;
  }

  state.extraZone.push(...cards);
  const projection = projectTurn(cards, boss);

  projection.enabledSuits.forEach((suit) => {
    const suitValue = projection.enabledCards.filter((card) => card.suit === suit).reduce((sum, card) => sum + card.value, 0);
    if (suit === 'spades') {
      boss.attack = Math.max(0, boss.attack - suitValue);
      pushLog(state, `黑桃削弱 Boss 攻击 ${suitValue} 点。`);
    }
    if (suit === 'hearts') recoverFromDiscard(suitValue);
    if (suit === 'clubs') {
      pushLog(state, '梅花使本次伤害翻倍。');
    }
    if (suit === 'diamonds') diamondHarvest(suitValue);
  });

  projection.blockedSuits.forEach((suit) => pushLog(state, `${bossName(boss)} 压制了${SUIT_NAME[suit]}效果。`));
  boss.hp = projection.projectedHp;
  pushLog(state, `${player.name} 打出 ${cards.map(cardText).join('、')}，造成 ${projection.damage} 点伤害。`);

  if (boss.hp <= 0) {
    killBoss(boss.hp === 0);
  } else {
    state.phase = 'defense';
    state.message = `${player.name} 需要弃牌防御，至少 ${boss.attack} 点。`;
  }
  render();
}

function recoverFromDiscard(count) {
  const take = Math.min(count, state.discardPile.length);
  if (take <= 0) {
    pushLog(state, '红桃尝试回收弃牌，但弃牌堆为空。');
    return;
  }
  const recovered = shuffle(state.discardPile).slice(0, take);
  state.discardPile = state.discardPile.filter((card) => !recovered.some((picked) => picked.id === card.id));
  state.drawPile.push(...recovered);
  pushLog(state, `红桃回收 ${take} 张弃牌到抽牌堆底。`);
}

function diamondHarvest(count) {
  let cursor = state.currentPlayer;
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    const player = state.players[cursor];
    if (state.drawPile.length === 0) break;
    if (player.hand.length < handLimit()) {
      player.hand.push(state.drawPile.shift());
      drawn += 1;
    }
    cursor = (cursor + 1) % state.players.length;
  }
  pushLog(state, `方块触发轮流抽牌，共抽到 ${drawn} 张。`);
}

function killBoss(perfect) {
  const defeated = state.currentBoss;
  if (!defeated) return;

  if (perfect) {
    state.drawPile.unshift(defeated);
    pushLog(state, `完美击杀！${bossName(defeated)} 被放到抽牌堆顶。`);
  } else {
    state.discardPile.push(defeated);
    pushLog(state, `${bossName(defeated)} 被击杀并进入弃牌堆。`);
  }

  state.discardPile.push(...state.extraZone);
  state.extraZone = [];
  state.currentBoss = state.bossDeck.shift() || null;
  state.selectedDefenseIds.clear();
  state.selectedDefenseOrder = [];

  if (!state.currentBoss) {
    state.phase = 'won';
    state.message = '所有 Boss 已被击杀，团队胜利。';
    return;
  }

  pushLog(state, `${bossName(state.currentBoss)} 登场。`);
  if (state.pendingSkill) {
    state.phase = 'target-player';
    state.message = '技能卡允许你指定下一名玩家。';
  } else {
    advanceTurn();
  }
}

function defendSelected() {
  if (state.phase !== 'defense' || !state.currentBoss) return;
  const cards = selectedDefenseCards();
  const defense = cards.reduce((sum, card) => sum + card.value, 0);

  if (defense < state.currentBoss.attack) {
    state.phase = 'lost';
    currentPlayer().alive = false;
    state.message = `${currentPlayer().name} 防御失败，游戏失败。`;
    pushLog(state, state.message);
    render();
    return;
  }

  currentPlayer().hand = currentPlayer().hand.filter((card) => !state.selectedDefenseIds.has(card.id));
  state.discardPile.push(...cards);
  state.selectedDefenseIds.clear();
  pushLog(state, `${currentPlayer().name} 弃牌防御 ${defense} 点。`);

  if (state.pendingSkill) {
    state.phase = 'target-player';
    state.message = '技能卡允许你指定下一名玩家。';
  } else {
    advanceTurn();
  }
  render();
}

function advanceTurn(target) {
  state.currentPlayer = typeof target === 'number' ? target : (state.currentPlayer + 1) % state.players.length;
  state.pendingSkill = false;
  state.phase = 'play';
  state.message = `${currentPlayer().name} 的回合。`;
  state.selectedHandIds.clear();
  state.selectedHandOrder = [];
  state.selectedDefenseIds.clear();
  state.selectedDefenseOrder = [];
}

function chooseNextPlayer(index) {
  if (state.phase !== 'target-player') return;
  pushLog(state, `${currentPlayer().name} 指定 ${state.players[index].name} 接续行动。`);
  advanceTurn(index);
  render();
}

function toggleSelection(cardId, mode) {
  const bucket = mode === 'defense' ? state.selectedDefenseIds : state.selectedHandIds;
  const orderKey = mode === 'defense' ? 'selectedDefenseOrder' : 'selectedHandOrder';
  if (bucket.has(cardId)) {
    bucket.delete(cardId);
    state[orderKey] = state[orderKey].filter((id) => id !== cardId);
  } else {
    bucket.add(cardId);
    state[orderKey].push(cardId);
  }
  render();
}

function cardText(card) {
  return card.kind === 'skill' ? '技能卡' : `${SUIT_LABEL[card.suit]}${card.rank}`;
}

function suitClass(card) {
  return card.suit === 'hearts' || card.suit === 'diamonds' ? 'red' : 'black';
}

function render() {
  const boss = state.currentBoss;
  const playCards = selectedPlayCards();
  const defenseCards = selectedDefenseCards();
  const playTotal = playCards.reduce((sum, card) => sum + card.value, 0);
  const defenseTotal = defenseCards.reduce((sum, card) => sum + card.value, 0);
  const playValidation = state.phase === 'play' && playCards.length > 0 ? validatePlay(playCards) : null;
  const projection = state.phase === 'play' ? projectTurn(playCards, boss) : null;

  app.innerHTML = `
    <section class="table">
      <header class="topbar">
        <div>
          <p class="eyebrow">合作扑克牌 Boss 战</p>
          <h1>弑君者</h1>
        </div>
        <div class="controls">
          <button class="icon-button" data-action="new4" title="开始 4 人局">4P</button>
          <button class="icon-button" data-action="new5" title="开始 5 人局">5P</button>
        </div>
      </header>

      <section class="arena">
        <div class="boss-panel">${boss ? bossMarkup(boss) : '<div class="empty-boss">王座已空</div>'}</div>
        <div class="pile-grid">
          ${pileMarkup('抽牌堆', state.drawPile.length, 'draw')}
          ${pileMarkup('额外区', state.extraZone.length, 'extra')}
          ${pileMarkup('弃牌堆', state.discardPile.length, 'discard')}
          ${pileMarkup('剩余 Boss', state.bossDeck.length, 'boss')}
        </div>
      </section>

      <section class="players">
        ${state.players.map((player, index) => playerMarkup(player, index)).join('')}
      </section>

      <section class="hand-zone">
        <div class="turn-head">
          <div>
            <p class="eyebrow">${phaseLabel()}</p>
            <h2>${currentPlayer().name}</h2>
          </div>
          <p class="message">${state.message || '选择手牌并行动。'}</p>
        </div>

        <div class="hand">
          ${currentPlayer().hand.map((card) => cardMarkup(card, state.phase === 'defense' ? 'defense' : 'play')).join('')}
        </div>

        ${effectPreviewMarkup(state.phase === 'defense' ? defenseCards : playCards, playValidation, projection)}

        <div class="action-row">
          <div class="meter">
            <span>出牌点数 ${playTotal}</span>
            ${state.phase === 'play' && boss && playCards.length > 0 && !playValidation ? `<span>预计伤害 ${projection.damage}</span><span>Boss 剩余 ${projection.projectedHp}/${boss.maxHp}</span>` : ''}
            <span>防御点数 ${defenseTotal}${boss ? ` / ${boss.attack}` : ''}</span>
          </div>
          <div class="buttons">
            ${state.phase === 'play' ? '<button class="primary" data-action="play">出牌</button>' : ''}
            ${state.phase === 'defense' ? '<button class="primary danger" data-action="defend">防御</button>' : ''}
            ${state.phase === 'target-player' ? state.players.map((player, index) => `<button class="target" data-target="${index}">${player.name}</button>`).join('') : ''}
          </div>
        </div>
      </section>

      <aside class="log">
        <h2>战况</h2>
        ${state.logs.map((line) => `<p>${line}</p>`).join('')}
      </aside>
    </section>
  `;
  bindEvents();
}

function phaseLabel() {
  return {
    play: '出牌阶段',
    defense: '防御阶段',
    'target-player': '指定下家',
    won: '胜利',
    lost: '失败',
  }[state.phase];
}

function effectPreviewMarkup(cards, validation, projection) {
  if (cards.length === 0 || state.phase === 'target-player' || state.phase === 'won' || state.phase === 'lost') {
    return `
      <div class="effect-preview empty">
        <span>花色预览</span>
        <p>选中手牌后显示花色效果。</p>
      </div>
    `;
  }

  return `
    <div class="effect-preview">
      <span>花色预览</span>
      ${validation ? `<p class="rule-warning">${validation}</p>` : previewSummaryMarkup(cards, projection)}
      <div class="effect-list">
        ${cards.map((card, index) => effectItemMarkup(card, index, projection)).join('')}
      </div>
    </div>
  `;
}

function previewSummaryMarkup(cards, projection) {
  if (state.phase !== 'play' || !state.currentBoss || !projection || cards.some((card) => card.kind === 'skill')) {
    return '';
  }

  return `<p class="preview-summary">预计造成 ${projection.damage} 点伤害，Boss 剩余 ${projection.projectedHp}/${state.currentBoss.maxHp}。</p>`;
}

function effectItemMarkup(card, index, projection) {
  const boss = state.currentBoss;
  if (card.kind === 'skill') {
    return `
      <div class="effect-item skill-effect">
        <strong>${index + 1}. 技能卡</strong>
        <p>无效当前 Boss 的花色压制，并指定下一名玩家。</p>
      </div>
    `;
  }

  const suppressed = state.phase === 'play' && boss && !boss.suitDisabled && card.suit === boss.suit;
  const clubPreview = state.phase === 'play' && card.suit === 'clubs' && projection && !suppressed
    ? `本次伤害由 ${projection.rawDamage} 点翻倍为 ${projection.damage} 点。`
    : null;
  const effectText = state.phase === 'defense'
    ? '防御弃牌不触发花色效果。'
    : clubPreview || `${SUIT_EFFECTS[card.suit]} ${card.value} 点。`;

  return `
    <div class="effect-item ${suitClass(card)} ${suppressed ? 'suppressed' : ''}">
      <strong>${index + 1}. ${cardText(card)} ${SUIT_NAME[card.suit]}</strong>
      <p>${suppressed ? `被 ${bossName(boss)} 压制，效果不触发。` : effectText}</p>
    </div>
  `;
}

function bossMarkup(boss) {
  const hpPercent = Math.max(0, Math.round((boss.hp / boss.maxHp) * 100));
  return `
    <div class="boss-card ${suitClass(boss)}">
      <div class="corner">${boss.rank}<span>${SUIT_LABEL[boss.suit]}</span></div>
      <div class="boss-title">${bossName(boss)}</div>
      <div class="boss-stat"><span>攻击</span><strong>${boss.attack}</strong></div>
      <div class="boss-stat"><span>血量</span><strong>${boss.hp}/${boss.maxHp}</strong></div>
      <div class="hp"><i style="width:${hpPercent}%"></i></div>
      <p>${boss.suitDisabled ? '花色压制已无效' : `压制${SUIT_NAME[boss.suit]}效果`}</p>
    </div>
  `;
}

function pileMarkup(label, count, kind) {
  return `
    <div class="pile ${kind}">
      <div class="deck-back"></div>
      <span>${label}</span>
      <strong>${count}</strong>
    </div>
  `;
}

function playerMarkup(player, index) {
  return `
    <div class="player ${index === state.currentPlayer ? 'active' : ''}">
      <span>${player.name}</span>
      <strong>${player.hand.length}/${handLimit()}</strong>
    </div>
  `;
}

function cardMarkup(card, mode) {
  const selected = mode === 'defense' ? state.selectedDefenseIds.has(card.id) : state.selectedHandIds.has(card.id);
  const disabled = state.phase === 'won' || state.phase === 'lost' || state.phase === 'target-player';
  if (card.kind === 'skill') {
    return `
      <button class="card skill ${selected ? 'selected' : ''}" data-card="${card.id}" data-mode="${mode}" ${disabled ? 'disabled' : ''}>
        <span class="rank">技</span>
        <span class="suit">令</span>
        <span class="value">指定</span>
      </button>
    `;
  }
  return `
    <button class="card ${suitClass(card)} ${selected ? 'selected' : ''}" data-card="${card.id}" data-mode="${mode}" ${disabled ? 'disabled' : ''}>
      <span class="rank">${card.rank}</span>
      <span class="suit">${SUIT_LABEL[card.suit]}</span>
      <span class="value">${card.value}</span>
    </button>
  `;
}

function bindEvents() {
  app.querySelector('[data-action="new4"]')?.addEventListener('click', () => {
    state = newGame(4);
    render();
  });
  app.querySelector('[data-action="new5"]')?.addEventListener('click', () => {
    state = newGame(5);
    render();
  });
  app.querySelector('[data-action="play"]')?.addEventListener('click', playSelected);
  app.querySelector('[data-action="defend"]')?.addEventListener('click', defendSelected);
  app.querySelectorAll('[data-card]').forEach((button) => {
    button.addEventListener('click', () => toggleSelection(button.dataset.card, button.dataset.mode));
  });
  app.querySelectorAll('[data-target]').forEach((button) => {
    button.addEventListener('click', () => chooseNextPlayer(Number(button.dataset.target)));
  });
}

render();
