// ============================================
// battle.js (Firebase Firestore 연동 버전)
// Zombie Battle Manager
// ============================================
//
// [수정 사항 - 이번 변경]
// - 캐릭터를 좀비로 전환할 때 이름 뒤에 붙던 "(전환됨)" 표기를 제거하고,
//   전환된 좀비도 원래 캐릭터 이름을 그대로 표시하도록 변경했습니다.
//   (convertCharacterToZombieEnemy, renderBattleCard의 좀비 목록,
//    renderRoundControls의 공격 대상 좀비 선택 목록 3곳 반영)
//
// [설계상 가정 - 원문에 명시되지 않아 임의로 정한 값들]
// 1) 좀비 공격 데미지: 성공/어려운 성공 = 2, 극단적 성공 = 4,
//    대성공 = 6 (DAMAGE_TABLE 에서 자유롭게 조정 가능)
// 2) 감염 판정: 어려운 성공 이상 피격 시 행운 판정 실시,
//    행운 판정 "실패" 시 감염, "성공" 시 저항(감염 안 됨).
//    단, 좀비가 대성공을 낸 경우 행운 판정 없이 무조건 감염.
// 3) 특기 판정: status.js 개편으로 캐릭터의 특기가 숫자 스탯이 아니라
//    텍스트(예: "해킹")로 바뀌었습니다. 판정용 숫자가 없으므로
//    임시로 고정 레벨(SPECIALTY_FALLBACK_LEVEL = 3, 기준치 50)로 굴립니다.
//    ⚠️ 이 처리가 맞는지 확인 필요 — 다른 방식을 원하면 알려주세요.
// 4) 좀비 지목 방식: 매 공격마다 "도주"/"전투불능" 상태가 아닌
//    생존 캐릭터 중에서 무작위로 새로 지목합니다(고정 타겟 없음).
//    도주로 전투를 이탈했거나 이미 전투불능인 캐릭터는 대상에서 제외됩니다.
// 5) HP 0 처리: 좀비/캐릭터 모두 "사망"이 아니라 "전투불능"으로 표기합니다.
// 6) 판정 표기: 모든 판정 로그는 "[주사위값/등급]" 형식으로 표기합니다.
//    예) [26/어려운 성공]
// 7) 대항 판정(예: 좀비 공격 vs 캐릭터 회피): 등급 순서는
//    대성공 > 극단적 성공 > 어려운 성공 > 성공 > 실패 > 대실패 입니다.
//    양측 모두 판정에 성공하더라도 등급이 더 낮은 쪽은 대항에서 패배한
//    것으로 처리합니다. 등급이 같다면 해당 판정에 쓰인 스탯값이 더 높은
//    쪽이 승리하며, 스탯값까지 같다면 방어측(회피)이 승리합니다.
// 8) 회피 판정에서 "대실패"가 나오면 추가 페널티로 HP -1이 적용됩니다.
//    (러너의 도주 판정, 캐릭터의 피격 회피 판정 모두 동일하게 적용)
//
// [전투 데이터 저장 방식]
// 전투(battle) 자체의 진행 상태는 여전히 localStorage에 저장합니다.
//
// [전투 로그 저장 기능]
// 각 전투 카드에 "전투 로그 저장" 버튼을 추가했습니다.
// ============================================

const BattleManager = (() => {

    // ----------------------------------------
    // 상수
    // ----------------------------------------

    const CHARACTER_MAX_HP = 10;

    const ZOMBIE_STAT_LEVEL = 3; // 좀비 스탯 33333 (기준치 50)

    const SPECIALTY_FALLBACK_LEVEL = 3; // 특기가 텍스트화되어 임시로 쓰는 판정 레벨

    const ZOMBIE_REQUIRED_HITS = 3;

    const INFECTION_CAPABLE_RANKS = ["어려운 성공", "극단적 성공", "대성공"];

    const DAMAGE_TABLE = {
        "실패": 0,
        "대실패": 0,
        "성공": 2,
        "어려운 성공": 2,
        "극단적 성공": 4,
        "대성공": 6
    };

    const RANK_ORDER = {
        "대성공": 4,
        "극단적 성공": 3,
        "어려운 성공": 2,
        "성공": 1,
        "실패": 0,
        "대실패": -1
    };

    const BODY_PARTS = [
        "목",
        "어깨(왼)", "어깨(오)",
        "팔(왼)", "팔(오)",
        "손(왼)", "손(오)",
        "허리",
        "허벅지(왼)", "허벅지(오)",
        "다리(왼)", "다리(오)",
        "발목(왼)", "발목(오)"
    ];

    const BATTLE_STORAGE_KEY = "battle_manager_data";

    // ----------------------------------------
    // 상태
    // ----------------------------------------

    let battles = [];

    // ----------------------------------------
    // 전투 데이터 저장/로드 (localStorage 유지)
    // ----------------------------------------

    function loadBattles() {

        const raw = localStorage.getItem(BATTLE_STORAGE_KEY);

        battles = raw ? JSON.parse(raw) : [];

    }

    function saveBattles() {

        localStorage.setItem(
            BATTLE_STORAGE_KEY,
            JSON.stringify(battles)
        );

    }

    // ----------------------------------------
    // 좀비 임시 스탯 객체 (판정용)
    // ----------------------------------------

    function makeZombieStatObject(zombie) {

        return {

            name: `좀비 #${zombie.id}`,

            profile: "",

            stats: {

                strength: ZOMBIE_STAT_LEVEL,

                agility: ZOMBIE_STAT_LEVEL,

                intelligence: ZOMBIE_STAT_LEVEL,

                luck: ZOMBIE_STAT_LEVEL,

                specialty: ZOMBIE_STAT_LEVEL

            }

        };

    }

    // 전환된 캐릭터는 원래 스탯(character.stats)을 그대로 사용,
    // 일반 좀비는 기존처럼 고정 스탯 사용

    function getZombieStatObject(zombie) {
        if (zombie.stats) {
            return { name: zombie.name, stats: zombie.stats };
        }
        return makeZombieStatObject(zombie);
    }

    // ----------------------------------------
    // 캐릭터의 "특기 판정용" 임시 스탯 객체
    // ----------------------------------------

    function makeSpecialtyRollObject(character) {

        return {

            name: character.name,

            stats: {

                specialty: SPECIALTY_FALLBACK_LEVEL

            }

        };

    }

    // ============================================
    // 전투 생성 (비동기: Firestore에서 캐릭터 원본을 가져옴)
    // ============================================

    async function createBattle(name, zombieCount, characterIds) {

        const source = await getCharacters();

        const battleCharacters = characterIds.map(id => {

            const original = source.find(c => c.id === id);

            return {

                id: original.id,

                name: original.name,

                profile: original.profile,

                stats: { ...original.stats },

                specialty: original.specialty || "",

                hp: CHARACTER_MAX_HP,

                maxHp: CHARACTER_MAX_HP,

                status: "alive", // alive | fled | down

                infections: []

            };

        });

        const zombies = [];

        for (let i = 1; i <= zombieCount; i++) {

            zombies.push({

                id: i,

                hits: 0,

                requiredHits: ZOMBIE_REQUIRED_HITS,

                alive: true

            });

        }

        const battle = {

            id: Date.now(),

            name: name || "이름없는 전투",

            round: 1,

            status: "ongoing", // ongoing | victory | defeat

            zombies,

            characters: battleCharacters,

            log: []

        };

        battles.push(battle);

        saveBattles();

        return battle;

    }

    function deleteBattle(battleId) {

        battles = battles.filter(b => b.id !== battleId);

        saveBattles();

    }

    function getBattle(battleId) {

        return battles.find(b => b.id === battleId);

    }

    // ============================================
    // 판정 보조
    // ============================================

    function rollStat(entity, statName) {

        return DiceEngine.rollCharacter(entity, statName);

    }

    function pickRandomBodyPart() {

        return DiceEngine.randomChoice(BODY_PARTS);

    }

    function formatRoll(result) {

        return `[${result.dice}/${result.rank}]`;

    }

    // ----------------------------------------
    // 대항 판정
    // ----------------------------------------

    function resolveContest(attackResult, attackStatValue, defenseResult, defenseStatValue) {

        if (!defenseResult.success) {

            return "attacker";

        }

        const attackRank = RANK_ORDER[attackResult.rank] ?? -1;

        const defenseRank = RANK_ORDER[defenseResult.rank] ?? -1;

        if (defenseRank > attackRank) {

            return "defender";

        }

        if (defenseRank < attackRank) {

            return "attacker";

        }

        if (defenseStatValue > attackStatValue) {

            return "defender";

        }

        if (attackStatValue > defenseStatValue) {

            return "attacker";

        }

        return "defender";

    }

    // ============================================
    // 캐릭터 행동 처리 (러너 페이즈)
    // ============================================

    function resolveAttack(battle, character, zombieId, log, summary) {

        // z.id는 일반 좀비는 숫자, 전환된 좀비는 문자열("T-...")이라
        // 타입이 다를 수 있으므로 문자열로 통일해서 비교
        const zombie = battle.zombies.find(z => String(z.id) === String(zombieId) && z.alive);

        if (!zombie) {

            log.push(`- ${character.name}: 대상 좀비가 이미 전투불능 상태여서 공격 취소`);

            return;

        }

        const result = rollStat(character, "strength");

        log.push(`- ${character.name} 공격(근력) 판정 ${formatRoll(result)}`);

        if (summary) {

            summary.attacks.push(`${character.name} 공격(근력) 판정 ${formatRoll(result)}`);

        }

        if (!result.success) {

            log.push(`  → 빗나감`);

            return;

        }

        if (result.rank === "대성공") {

            zombie.hits = zombie.requiredHits;

        }

        else if (result.rank === "극단적 성공") {

            zombie.hits += 2;

        }

        else {

            zombie.hits += 1;

        }

        const zombieDisplayName = zombie.isTurnedCharacter ? zombie.name : `좀비 #${zombie.id}`;

        if (zombie.hits >= zombie.requiredHits) {

            zombie.alive = false;

            log.push(`  → ${zombieDisplayName} 전투불능!`);

        }

        else {

            log.push(`  → ${zombieDisplayName} 피해 누적 (${zombie.hits}/${zombie.requiredHits})`);

        }

    }

    function resolveEvade(character, log, summary) {

        const result = rollStat(character, "agility");

        log.push(`- ${character.name} 회피/도주(민첩) 판정 ${formatRoll(result)}`);

        if (summary) {

            summary.flees.push(`${character.name} 도주(민첩) 판정 ${formatRoll(result)}`);

        }

        if (result.success) {

            character.status = "fled";

            log.push(`  → 도주 성공, 전투 이탈`);

            return;

        }

        log.push(`  → 도주 실패, 전투 지속`);

        if (result.rank === "대실패") {

            character.hp = Math.max(0, character.hp - 1);

            log.push(`  → 회피 대실패! 추가 페널티로 HP -1 (남은 HP ${character.hp}/${character.maxHp})`);

            if (character.hp <= 0 && character.status === "alive") {

                character.status = "down";

                log.push(`  → ${character.name} 전투불능!`);

            }

        }

    }

    // ============================================
    // 캐릭터 → 좀비 진영 수동 전환 (진행자용)
    // ============================================

    function convertCharacterToZombieEnemy(battleId, characterId) {

        const battle = getBattle(battleId);

        if (!battle) return null;

        const idx = battle.characters.findIndex(c => c.id === characterId);

        if (idx === -1) return null;

        const character = battle.characters[idx];

        const turnedZombie = {

            id: `T-${character.id}`,

            name: character.name, // 이름 그대로 유지 ("(전환됨)" 접미사 제거)

            hits: 0,

            requiredHits: ZOMBIE_REQUIRED_HITS,

            alive: true,

            isTurnedCharacter: true,

            sourceCharacterId: character.id,

            stats: { ...character.stats }

        };

        battle.zombies.push(turnedZombie);

        battle.characters.splice(idx, 1);

        battle.log.push(`⚠ ${character.name}이(가) 좀비로 전환되었습니다.`);

        saveBattles();

        return battle;

    }


    function resolveSpecialty(character, log) {

        const hasStoredLevel =
            character.stats &&
            typeof character.stats.specialty === "number" &&
            !Number.isNaN(character.stats.specialty);

        const rollObject = hasStoredLevel
            ? character
            : makeSpecialtyRollObject(character);

        const result = rollStat(rollObject, "specialty");

        const specialtyLabel = character.specialty
            ? `특기(${character.specialty})`
            : "특기";

        log.push(`- ${character.name} ${specialtyLabel} 판정 ${formatRoll(result)}`);

        if (!hasStoredLevel) {

            log.push(`  (⚠ status.html에 저장된 특기 레벨이 없어 임시 레벨 ${SPECIALTY_FALLBACK_LEVEL} 사용)`);

        }

        log.push(
            result.success
                ? `  → 특기 성공 (효과는 별도 규칙에 따라 GM이 적용)`
                : `  → 특기 실패`
        );

    }

    // ============================================
    // 좀비 행동 처리 (좀비 페이즈)
    // ============================================

    function resolveZombieAttack(battle, zombie, log, summary) {

        const aliveCharacters = battle.characters.filter(c => c.status === "alive");

        if (aliveCharacters.length === 0) {

            const zombieDisplayName = zombie.isTurnedCharacter ? zombie.name : `좀비 #${zombie.id}`;

            log.push(`- ${zombieDisplayName}: 공격 가능한 대상 없음`);

            return;

        }

        const target = DiceEngine.randomChoice(aliveCharacters);

        const zombieDisplayName = zombie.isTurnedCharacter ? zombie.name : `좀비 #${zombie.id}`;

        log.push(`- ${zombieDisplayName} → ${target.name}을(를) 지목!`);

        const zombieStatObj = getZombieStatObject(zombie);

        const attackResult = rollStat(zombieStatObj, "strength");

        log.push(`  공격 판정 ${formatRoll(attackResult)}`);

        if (summary) {

            summary.zombieAttacks.push(`${zombieDisplayName} 공격 판정 ${formatRoll(attackResult)}`);

        }

        if (!attackResult.success) {

            log.push(`  → 빗나감`);

            return;

        }

        const evadeResult = rollStat(target, "agility");

        log.push(`  → ${target.name} 회피 판정 ${formatRoll(evadeResult)}`);

        if (summary) {

            summary.evades.push(`${target.name} 회피(민첩) 판정 ${formatRoll(evadeResult)}`);

        }

        const winner = resolveContest(
            attackResult,
            zombieStatObj.stats.strength,
            evadeResult,
            target.stats.agility
        );

        if (evadeResult.rank === "대실패") {

            target.hp = Math.max(0, target.hp - 1);

            log.push(`  → 회피 대실패! 추가 페널티로 HP -1 (남은 HP ${target.hp}/${target.maxHp})`);

        }

        if (winner === "defender") {

            log.push(
                evadeResult.success
                    ? `  → 회피 성공! 피해 없음`
                    : `  → 회피 실패했으나 대항 판정 승리, 피해 없음`
            );

            if (target.hp <= 0 && target.status === "alive") {

                target.status = "down";

                log.push(`  → ${target.name} 전투불능!`);

            }

            return;

        }

        log.push(
            evadeResult.success
                ? `  → 회피에 성공했으나 성공 등급이 낮아 대항 판정 패배`
                : `  → 회피 실패`
        );

        const damage = DAMAGE_TABLE[attackResult.rank] ?? 0;

        target.hp = Math.max(0, target.hp - damage);

        log.push(`  → ${target.name} 피해 ${damage} (남은 HP ${target.hp}/${target.maxHp})`);

        let infected = false;

        if (INFECTION_CAPABLE_RANKS.includes(attackResult.rank)) {

            if (attackResult.rank === "대성공") {

                infected = true;

                log.push(`  → 대성공! 행운 판정 없이 감염 확정`);

            }

            else {

                const luckCheck = rollStat(target, "luck");

                log.push(`  → 감염 위험, 행운 판정 ${formatRoll(luckCheck)}`);

                if (summary) {

                    summary.lucks.push(`${target.name} 행운 판정 ${formatRoll(luckCheck)}`);

                }

                infected = !luckCheck.success;

                log.push(infected ? `  → 행운 판정 실패, 감염됨` : `  → 행운 판정 성공, 감염 저항`);

            }

        }

        if (infected) {

            const part = pickRandomBodyPart();

            target.infections.push({ part, round: battle.round });

            log.push(`  → 감염 부위: ${part}`);

        }

        if (target.hp <= 0 && target.status === "alive") {

            target.status = "down";

            log.push(`  → ${target.name} 전투불능!`);

        }

    }

    // ============================================
    // 라운드 진행
    // ============================================

    function resolveRound(battleId, actions, skipRunnerPhase) {

        const battle = getBattle(battleId);

        if (!battle || battle.status !== "ongoing") return battle;

        const log = [];

        const roundSummary = {
            attacks: [],
            flees: [],
            zombieAttacks: [],
            evades: [],
            lucks: []
        };

        log.push(`===== ${battle.round} 라운드 =====`);

        if (!skipRunnerPhase) {

            log.push(`[러너 페이즈]`);

            battle.characters.forEach(character => {

                if (character.status !== "alive") return;

                const action = actions[character.id];

                if (!action || action.type === "none") {

                    log.push(`- ${character.name}: 행동 없음`);

                    return;

                }

                if (action.type === "attack") {

                    resolveAttack(battle, character, action.targetZombieId, log, roundSummary);

                }

                else if (action.type === "evade") {

                    resolveEvade(character, log, roundSummary);

                }

                else if (action.type === "specialty") {

                    resolveSpecialty(character, log);

                }

            });

        }

        else {

            log.push(`[러너 페이즈 생략 - 좀비 선공]`);

        }

        log.push(`[좀비 페이즈]`);

        battle.zombies.forEach(zombie => {

            if (!zombie.alive) return;

            resolveZombieAttack(battle, zombie, log, roundSummary);

        });

        log.push(`----- ${battle.round}라운드 판정 요약 -----`);

        if (roundSummary.attacks.length > 0) {

            log.push(`러너 페이즈`);

            roundSummary.attacks.forEach(entry => log.push(entry));

        }

        if (roundSummary.flees.length > 0) {

            log.push(`캐릭터 도주`);

            roundSummary.flees.forEach(entry => log.push(entry));

        }

        if (roundSummary.zombieAttacks.length > 0) {

            log.push(`좀비 페이즈`);

            roundSummary.zombieAttacks.forEach(entry => log.push(entry));

        }

        if (roundSummary.evades.length > 0) {

            log.push(`캐릭터 회피`);

            roundSummary.evades.forEach(entry => log.push(entry));

        }

        if (roundSummary.lucks.length > 0) {

            log.push(`캐릭터 행운`);

            roundSummary.lucks.forEach(entry => log.push(entry));

        }

        battle.log.push(...log);

        const allZombiesDead = battle.zombies.every(z => !z.alive);

        const allCharactersOut = battle.characters.every(c => c.status !== "alive");

        if (allZombiesDead) {

            battle.status = "victory";

            battle.log.push(`===== 전투 종료: 좀비 전멸, 승리! =====`);

        }

        else if (allCharactersOut) {

            battle.status = "defeat";

            battle.log.push(`===== 전투 종료: 모든 캐릭터 전투불능/도주 =====`);

        }

        else {

            battle.round += 1;

        }

        saveBattles();

        return battle;

    }

    // ============================================
    // 반환
    // ============================================

return {

        loadBattles,

        saveBattles,

        createBattle,

        deleteBattle,

        getBattle,

        get battles() { return battles; },

        resolveRound,

        rollStat,

        pickRandomBodyPart,

        convertCharacterToZombieEnemy,

        BODY_PARTS,

        ZOMBIE_STAT_LEVEL,

        CHARACTER_MAX_HP

    };

})();

console.log("Battle Manager Ready");


// ============================================
// ============================================
// UI 렌더링
// ============================================
// ============================================

document.addEventListener("DOMContentLoaded", () => {

    BattleManager.loadBattles();

    renderCharacterSelectList();

    renderAllBattles();

    wireUtilityPanels();

    document.getElementById("btnCreateBattle")
        .addEventListener("click", handleCreateBattle);

});

// ----------------------------------------
// 참여 캐릭터 체크박스 (비동기: Firestore에서 로드)
// ----------------------------------------

async function renderCharacterSelectList() {

    const container = document.getElementById("characterSelectList");

    container.innerHTML = "<p>불러오는 중...</p>";

    const characters = await getCharacters();

    container.innerHTML = "";

    if (characters.length === 0) {

        container.innerHTML = `<p>등록된 캐릭터가 없습니다. status.html 에서 먼저 캐릭터를 등록하세요.</p>`;

        return;

    }

    characters.forEach(character => {

        const label = document.createElement("label");

        label.className = "character-select-item";

        label.style.display = "inline-flex";
        label.style.alignItems = "center";
        label.style.gap = "4px";
        label.style.marginRight = "12px";

        label.innerHTML = `
            <input type="checkbox" class="battleCharCheckbox" value="${character.id}">
            ${character.name}
            (근${character.stats.strength}/민${character.stats.agility}/행${character.stats.luck}${character.specialty ? " / 특:" + character.specialty : ""})
        `;

        container.appendChild(label);

    });

}

// ----------------------------------------
// 선택된 캐릭터 id 목록
// ----------------------------------------

function getSelectedCharacterIds() {

    return Array.from(document.querySelectorAll(".battleCharCheckbox:checked"))
        .map(el => el.value);

}

// ----------------------------------------
// 전투 생성 처리 (비동기)
// ----------------------------------------

async function handleCreateBattle() {

    const name = document.getElementById("battleName").value.trim();

    const zombieCount = Math.max(
        1,
        Number(document.getElementById("zombieCount").value) || 1
    );

    const characterIds = getSelectedCharacterIds();

    if (characterIds.length === 0) {

        alert("참여할 캐릭터를 최소 1명 선택하세요.");

        return;

    }

    const btn = document.getElementById("btnCreateBattle");
    btn.disabled = true;

    try {

        await BattleManager.createBattle(name, zombieCount, characterIds);

        document.getElementById("battleName").value = "";

        renderAllBattles();

    }

    catch (error) {

        alert("전투 생성 중 오류가 발생했습니다.");
        console.error(error);

    }

    finally {

        btn.disabled = false;

    }

}

// ============================================
// 전투 목록 렌더링
// ============================================

function renderAllBattles() {

    const area = document.getElementById("battleArea");

    area.innerHTML = "";

    if (BattleManager.battles.length === 0) {

        area.innerHTML = `<p class="placeholder-text" id="noBattlePlaceholder">아직 생성된 전투가 없습니다.</p>`;

        return;

    }

    BattleManager.battles.forEach(battle => {

        area.appendChild(renderBattleCard(battle));

    });

}

const collapsedBattleIds = new Set();

function renderBattleCard(battle) {

    const card = document.createElement("div");

    card.className = "card battle-card";

    const statusText = {
        ongoing: "진행중",
        victory: "승리",
        defeat: "패배/전멸"
    }[battle.status];

    const isCollapsed = collapsedBattleIds.has(battle.id);

    card.innerHTML = `
        <div class="battle-card-header" style="display:flex; align-items:center; justify-content:space-between; gap:8px; cursor:pointer;">
            <h2 style="margin:0;">${battle.name} (${battle.round}라운드 / ${statusText})</h2>
            <button class="btnToggleBattle" type="button">${isCollapsed ? "▶ 펼치기" : "▼ 접기"}</button>
        </div>
        <div class="battle-card-body" style="${isCollapsed ? "display:none;" : ""}">
            <button class="btnDeleteBattle">전투 삭제</button>
            <button class="btnSaveLog">📄 전투 로그 저장</button>
            <h3>좀비</h3>
            <div class="zombie-list"></div>
            <h3>캐릭터</h3>
            <div class="character-list"></div>
        </div>
    `;

    const headerEl = card.querySelector(".battle-card-header");
    const toggleBtn = card.querySelector(".btnToggleBattle");
    const bodyEl = card.querySelector(".battle-card-body");

    const toggleCollapse = () => {

        const collapsing = bodyEl.style.display !== "none";

        bodyEl.style.display = collapsing ? "none" : "";
        toggleBtn.textContent = collapsing ? "▶ 펼치기" : "▼ 접기";

        if (collapsing) {
            collapsedBattleIds.add(battle.id);
        } else {
            collapsedBattleIds.delete(battle.id);
        }

    };

    headerEl.addEventListener("click", (e) => {

        if (e.target === toggleBtn) return;

        toggleCollapse();

    });

    toggleBtn.addEventListener("click", toggleCollapse);

    card.querySelector(".btnDeleteBattle")
        .addEventListener("click", (e) => {

            e.stopPropagation();

            if (!confirm("이 전투를 삭제하시겠습니까?")) return;

            BattleManager.deleteBattle(battle.id);

            renderAllBattles();

        });

    card.querySelector(".btnSaveLog")
        .addEventListener("click", (e) => {

            e.stopPropagation();

            saveBattleLogToFile(battle);

        });

    const zombieListEl = card.querySelector(".zombie-list");

    battle.zombies.forEach(zombie => {

        const row = document.createElement("div");

        // 전환된 캐릭터는 원래 이름을 그대로, 일반 좀비는 "좀비 #n" 표기
        const zombieLabel = zombie.isTurnedCharacter
            ? zombie.name
            : `좀비 #${zombie.id}`;

        row.textContent =
            `${zombieLabel} - ${zombie.alive ? "생존" : "전투불능"} `
            + `(피해 ${zombie.hits}/${zombie.requiredHits})`;

        zombieListEl.appendChild(row);

    });

    const charListEl = card.querySelector(".character-list");

    battle.characters.forEach(character => {

        const row = document.createElement("div");

        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.gap = "8px";

        const statusText2 = {
            alive: "생존",
            fled: "도주",
            down: "전투불능"
        }[character.status];

        const infectionText = character.infections.length > 0
            ? ` / 감염부위: ${character.infections.map(i => i.part).join(", ")}`
            : "";

        const infoSpan = document.createElement("span");

        infoSpan.textContent =
            `${character.name} - HP ${character.hp}/${character.maxHp} `
            + `(${statusText2})${infectionText}`;

        row.appendChild(infoSpan);

        if (battle.status === "ongoing") {

            const btnConvert = document.createElement("button");

            btnConvert.type = "button";
            btnConvert.className = "btnConvertToZombie";
            btnConvert.textContent = "🧟 좀비로 전환";

            btnConvert.addEventListener("click", (e) => {

                e.stopPropagation();

                if (!confirm(`${character.name}을(를) 적대 진영(좀비)으로 전환하시겠습니까?\n이 행동은 되돌릴 수 없습니다.`)) {
                    return;
                }

                BattleManager.convertCharacterToZombieEnemy(battle.id, character.id);

                renderAllBattles();

            });

            row.appendChild(btnConvert);

        }

        charListEl.appendChild(row);

    });

    if (battle.status === "ongoing") {

        bodyEl.appendChild(renderRoundControls(battle));

    }

    const logBox = document.createElement("pre");

    logBox.className = "battle-log";

    logBox.style.maxHeight = "200px";
    logBox.style.overflowY = "auto";
    logBox.style.background = "#111";
    logBox.style.color = "#0f0";
    logBox.style.padding = "8px";
    logBox.style.marginTop = "8px";

    logBox.textContent = battle.log.join("\n");

    bodyEl.appendChild(logBox);

    return card;

}

// ----------------------------------------
// 라운드 행동 선택 UI
// ----------------------------------------

function renderRoundControls(battle) {

    const wrap = document.createElement("div");

    wrap.className = "round-controls";

    wrap.innerHTML = `<h3>이번 라운드 행동</h3>`;

    const skipRow = document.createElement("label");

    skipRow.innerHTML = `
        <input type="checkbox" class="skipRunnerPhase">
        러너 공격 생략 (좀비 선공)
    `;

    wrap.appendChild(skipRow);

    const aliveCharacters = battle.characters.filter(c => c.status === "alive");

    const aliveZombies = battle.zombies.filter(z => z.alive);

    aliveCharacters.forEach(character => {

        const row = document.createElement("div");

        row.className = "action-row";

        row.dataset.characterId = character.id;

        // 전환된 캐릭터는 원래 이름을, 일반 좀비는 "좀비 #n"으로 표기
        const zombieOptions = aliveZombies
            .map(z => {
                const label = z.isTurnedCharacter ? z.name : `좀비 #${z.id}`;
                return `<option value="${z.id}">${label}</option>`;
            })
            .join("");

        row.innerHTML = `
            <b>${character.name}</b>
            <select class="actionType">
                <option value="attack">공격(근력)</option>
                <option value="evade">회피/도주(민첩)</option>
                <option value="specialty">특기</option>
                <option value="none">행동 안 함</option>
            </select>
            <select class="actionTargetZombie">
                ${zombieOptions}
            </select>
        `;

        const actionTypeSelect = row.querySelector(".actionType");

        const targetSelect = row.querySelector(".actionTargetZombie");

        actionTypeSelect.addEventListener("change", () => {

            targetSelect.style.display =
                actionTypeSelect.value === "attack" ? "" : "none";

        });

        wrap.appendChild(row);

    });

    const btnResolve = document.createElement("button");

    btnResolve.textContent = "라운드 진행";

    btnResolve.addEventListener("click", () => {

        const actions = {};

        wrap.querySelectorAll(".action-row").forEach(row => {

            const characterId = row.dataset.characterId;

            const type = row.querySelector(".actionType").value;

            // 전환된 좀비는 id가 문자열("T-...")이라 Number()로 변환하면 NaN이 되어
            // 대상을 못 찾는 버그가 있었음 → 원본 문자열 값을 그대로 사용
            const targetZombieId = row.querySelector(".actionTargetZombie").value;

            actions[characterId] = { type, targetZombieId };

        });

        const skipRunnerPhase = wrap.querySelector(".skipRunnerPhase").checked;

        BattleManager.resolveRound(battle.id, actions, skipRunnerPhase);

        renderAllBattles();

    });

    wrap.appendChild(btnResolve);

    return wrap;

}

// ============================================
// 전투 로그 저장 (텍스트 파일 다운로드)
// ============================================

function buildBattleLogText(battle) {

    const statusText = {
        ongoing: "진행중",
        victory: "승리",
        defeat: "패배/전멸"
    }[battle.status];

    const timestamp = new Date().toLocaleString("ko-KR");

    const header =
        `=== ${battle.name} 전투 로그 ===\n`
        + `저장 시각: ${timestamp}\n`
        + `상태: ${statusText} / ${battle.round}라운드\n`
        + `----------------------------------------\n`;

    const characterSummary = battle.characters.map(c => {

        const statusText2 = {
            alive: "생존",
            fled: "도주",
            down: "전투불능"
        }[c.status];

        const infectionText = c.infections.length > 0
            ? ` / 감염부위: ${c.infections.map(i => i.part).join(", ")}`
            : "";

        return `- ${c.name}: HP ${c.hp}/${c.maxHp} (${statusText2})${infectionText}`;

    }).join("\n");

    const footer =
        `----------------------------------------\n`
        + `[최종 캐릭터 상태]\n${characterSummary}\n`
        + `----------------------------------------\n\n`;

    return header + battle.log.join("\n") + "\n\n" + footer;

}

function saveBattleLogToFile(battle) {

    const text = buildBattleLogText(battle);

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });

    const url = URL.createObjectURL(blob);

    const safeName = battle.name.replace(/[^a-zA-Z0-9가-힣_-]/g, "_") || "battle";

    const a = document.createElement("a");

    a.href = url;
    a.download = `전투로그_${safeName}_${battle.id}.txt`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);

}

// ============================================
// 유틸리티 패널: 간이 다이스 판정 / 감염 부위 결정
// ============================================

function wireUtilityPanels() {

    const btnQuickDiceRoll = document.getElementById("btnQuickDiceRoll");

    if (btnQuickDiceRoll) {

        btnQuickDiceRoll.addEventListener("click", () => {

            const level = Number(
                document.getElementById("quickDiceStatLevel").value
            );

            const result = DiceEngine.roll(level);

            document.getElementById("quickDiceResult").textContent =
                `[${result.dice}/${result.rank}]`;
        });
    }

    const btnPickBodyPart = document.getElementById("btnPickBodyPart");
    if (btnPickBodyPart) {
        btnPickBodyPart.addEventListener("click", () => {
            const part = BattleManager.pickRandomBodyPart();
            document.getElementById("bodyPartResult").textContent =
                `감염 부위: ${part}`;
        });
    }

}
