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
// 3) 좀비 지목 방식: 매 공격마다 "도주"/"전투불능" 상태가 아닌
//    생존 캐릭터 중에서 무작위로 새로 지목합니다(고정 타겟 없음).
//    도주로 전투를 이탈했거나 이미 전투불능인 캐릭터는 대상에서 제외됩니다.
// 4) HP 0 처리: 좀비/캐릭터 모두 "사망"이 아니라 "전투불능"으로 표기합니다.
// 5) 판정 표기: 모든 판정 로그는 "[주사위값/등급]" 형식으로 표기합니다.
//    예) [26/어려운 성공]
// 6) 대항 판정(예: 좀비 공격 vs 캐릭터 회피): 등급 순서는
//    대성공 > 극단적 성공 > 어려운 성공 > 성공 > 실패 > 대실패 입니다.
//    양측 모두 판정에 성공하더라도 등급이 더 낮은 쪽은 대항에서 패배한
//    것으로 처리합니다. 등급이 같다면 해당 판정에 쓰인 스탯값이 더 높은
//    쪽이 승리하며, 스탯값까지 같다면 방어측(회피)이 승리합니다.
// 7) 회피 판정에서 "대실패"가 나오면 추가 페널티로 HP -1이 적용됩니다.
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
        
                specialtyValue: typeof original.specialtyValue === "number"
                    ? original.specialtyValue
                    : null,
        
                hp: CHARACTER_MAX_HP,
        
                maxHp: CHARACTER_MAX_HP,
        
                status: "alive",
        
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

function resolveAssistEvade(character, targetCharacter, log, summary) {

    const result = rollStat(character, "agility");

    log.push(`- ${character.name} → ${targetCharacter.name} 회피 보조 판정(민첩) ${formatRoll(result)}`);

    if (summary) {
        summary.assists.push(`${character.name} → ${targetCharacter.name} 회피 보조 판정 ${formatRoll(result)}`);
    }

    if (result.success) {

        log.push(`  → 보조 성공! ${targetCharacter.name}은(는) 이번 라운드 자동 회피 확보`);

    }

    else {

        log.push(`  → 보조 실패, ${targetCharacter.name}에게 자동 회피 제공 못함 (다른 동료가 성공했다면 여전히 유효)`);

    }

    return result.success;

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


    function setZombieHits(battleId, zombieId, newHits) {
            const battle = getBattle(battleId);
            if (!battle) return null;
            const zombie = battle.zombies.find(z => String(z.id) === String(zombieId));
            if (!zombie) return null;
        
            const clamped = Math.max(0, Math.min(Number(newHits) || 0, zombie.requiredHits));
            const old = zombie.hits;
        
            zombie.hits = clamped;
            zombie.alive = zombie.hits < zombie.requiredHits;
        
            const displayName = zombie.isTurnedCharacter ? zombie.name : `좀비 #${zombie.id}`;
        
            battle.log.push(`⚙ [수동 조정] ${displayName} 누적 피해 ${old} → ${zombie.hits}${zombie.alive ? "" : " (전투불능 처리)"}`);
            saveBattles();
            return battle;
    }

function setCharacterHp(battleId, characterId, newHp) {

    const battle = getBattle(battleId);
    if (!battle) return null;
    const character = battle.characters.find(c => c.id === characterId);
    if (!character) return null;
    const clamped = Math.max(0, Math.min(Number(newHp) || 0, character.maxHp));
    const old = character.hp;

    character.hp = clamped;

    if (character.hp <= 0 && character.status === "alive") {
        character.status = "down";
    }

    else if (character.hp > 0 && character.status === "down") {
        character.status = "alive"; // GM 수동 소생/회복 처리
    }

    battle.log.push(`⚙ [수동 조정] ${character.name} HP ${old} → ${character.hp}${character.status === "down" ? " (전투불능 처리)" : ""}`);
    saveBattles();
    return battle;
}


// ★ 추가: 감염 수동 추가 (GM용)
function addCharacterInfection(battleId, characterId, part) {

    const battle = getBattle(battleId);
    if (!battle) return null;
    const character = battle.characters.find(c => c.id === characterId);
    if (!character) return null;

    const usedPart = part || pickRandomBodyPart();

    character.infections.push({ part: usedPart, round: battle.round });

    battle.log.push(`⚙ [수동 조정] ${character.name} 감염 부위 추가: ${usedPart}`);

    saveBattles();
    return battle;

}

// ★ 추가: 감염 수동 제거 (GM용)
function removeCharacterInfection(battleId, characterId, infectionIndex) {

    const battle = getBattle(battleId);
    if (!battle) return null;
    const character = battle.characters.find(c => c.id === characterId);
    if (!character) return null;

    const removed = character.infections[infectionIndex];
    if (!removed) return null;

    character.infections.splice(infectionIndex, 1);

    battle.log.push(`⚙ [수동 조정] ${character.name} 감염 부위 제거: ${removed.part}`);

    saveBattles();
    return battle;

}

    
  function resolveSpecialty(character, log) {

        const rollObject = {

            name: character.name,

            stats: { specialty: character.specialtyValue }

        };

        const result = rollStat(rollObject, "specialty");

        const specialtyLabel = character.specialty
            ? `특기(${character.specialty})`
            : "특기";

        log.push(`- ${character.name} ${specialtyLabel} 판정 ${formatRoll(result)}`);

        log.push(
            result.success
                ? `  → 특기 성공 (효과는 별도 규칙에 따라 GM이 적용)`
                : `  → 특기 실패`
        );

    }

    // ============================================
    // 좀비 행동 처리 (좀비 페이즈)
    // ============================================

// ★ 추가: 피격 시 피해 적용 + 감염 판정 (공통 로직 분리)
function applyZombieHit(battle, target, attackResult, log, summary) {

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

    
function resolveZombieAttack(battle, zombie, log, summary, assistedIds, assistingIds) {

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

    // 회피 보조를 "받는" 캐릭터: 판정 없이 자동 회피 성공
    if (assistedIds && assistedIds.has(target.id)) {
        log.push(`  → ${target.name}은(는) 동료의 회피 보조를 받아 자동 회피 성공! 피해 없음`);
        if (summary) {
            summary.evades.push(`${target.name} 회피 자동 성공 (동료 보조)`);
        }
        return;
    }

    // ★ 추가: 회피 보조를 "주는" 캐릭터가 지목당한 경우 → 판정 없이 자동 회피 실패
    if (assistingIds && assistingIds.has(target.id)) {
        log.push(`  → ${target.name}은(는) 동료를 보조하느라 자신을 방어하지 못해 자동으로 피격!`);
        if (summary) {
            summary.evades.push(`${target.name} 회피 자동 실패 (동료 보조 중)`);
        }
        applyZombieHit(battle, target, attackResult, log, summary);
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

    applyZombieHit(battle, target, attackResult, log, summary);

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
        assists: [],
        zombieAttacks: [],
        evades: [],
        lucks: []
    };

    const assistedCharacterIds = new Set();   // 보조를 "받는" 쪽
    const assistingCharacterIds = new Set();  // ★ 추가: 보조를 "주는" 쪽

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

        // 회피 보조
                else if (action.type === "assistEvade") {
    
                    const targetCharacter = battle.characters.find(
                        c => String(c.id) === String(action.targetCharacterId)
                            && c.status === "alive"
                            && c.id !== character.id
                    );
    
                    if (!targetCharacter) {
                        log.push(`- ${character.name}: 회피 보조 대상이 유효하지 않아 취소`);
                        return;
                    }
    
                    // 보조를 "주는" 쪽은 판정 성공/실패와 무관하게 자기 방어에 소홀해짐
                    assistingCharacterIds.add(character.id);
    
                    const assistSuccess = resolveAssistEvade(character, targetCharacter, log, roundSummary);
    
                    // ★ 변경: 판정에 성공했을 때만 대상을 보호 목록에 추가.
                    // Set이므로 이미 다른 동료의 보조로 추가돼 있다면 유지되고,
                    // 이번 보조가 실패해도 기존 성공 기록이 지워지지 않음
                    // → "여러 명이 보조 시 한 명이라도 성공하면 보호 성립" 조건 자동 충족
                    if (assistSuccess) {
                        assistedCharacterIds.add(targetCharacter.id);
                    }
                }
        });
    }

    else {

        log.push(`[러너 페이즈 생략 - 좀비 선공]`);

    }

    log.push(`[좀비 페이즈]`);

    battle.zombies.forEach(zombie => {

        if (!zombie.alive) return;

        resolveZombieAttack(battle, zombie, log, roundSummary, assistedCharacterIds, assistingCharacterIds);

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

    if (roundSummary.assists.length > 0) {
        log.push(`회피 보조`);
        roundSummary.assists.forEach(entry => log.push(entry));
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
        setZombieHits,
        setCharacterHp,
        addCharacterInfection,      // ★ 추가
        removeCharacterInfection,   // ★ 추가
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

        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "8px";
        row.style.marginBottom = "4px";

        // 전환된 캐릭터는 원래 이름을 그대로, 일반 좀비는 "좀비 #n" 표기
        const zombieLabel = zombie.isTurnedCharacter
            ? zombie.name
            : `좀비 #${zombie.id}`;

        const infoSpan = document.createElement("span");

        infoSpan.textContent =
            `${zombieLabel} - ${zombie.alive ? "생존" : "전투불능"} `
            + `(피해 ${zombie.hits}/${zombie.requiredHits})`;

        row.appendChild(infoSpan);

        if (battle.status === "ongoing") {

            const hitsInput = document.createElement("input");

            hitsInput.type = "number";
            hitsInput.min = "0";
            hitsInput.max = String(zombie.requiredHits);
            hitsInput.value = String(zombie.hits);
            hitsInput.style.width = "50px";

            const btnApplyHits = document.createElement("button");

            btnApplyHits.type = "button";
            btnApplyHits.textContent = "피해 적용";

            btnApplyHits.addEventListener("click", (e) => {

                e.stopPropagation();

                BattleManager.setZombieHits(battle.id, zombie.id, hitsInput.value);

                renderAllBattles();

            });

            row.appendChild(hitsInput);
            row.appendChild(btnApplyHits);

        }

        zombieListEl.appendChild(row);

    });

const charListEl = card.querySelector(".character-list");

    battle.characters.forEach(character => {

        const wrapper = document.createElement("div");

        wrapper.style.border = "1px solid #333";
        wrapper.style.borderRadius = "4px";
        wrapper.style.padding = "6px";
        wrapper.style.marginBottom = "6px";

        const row = document.createElement("div");

        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.gap = "8px";
        row.style.flexWrap = "wrap";

        const statusText2 = {
            alive: "생존",
            fled: "도주",
            down: "전투불능"
        }[character.status];

        const infoSpan = document.createElement("span");

        infoSpan.textContent =
            `${character.name} - HP ${character.hp}/${character.maxHp} `
            + `(${statusText2})`;

        row.appendChild(infoSpan);

        if (battle.status === "ongoing") {

            // ★ 추가: HP 수동 조정
            const hpInput = document.createElement("input");

            hpInput.type = "number";
            hpInput.min = "0";
            hpInput.max = String(character.maxHp);
            hpInput.value = String(character.hp);
            hpInput.style.width = "50px";

            const btnApplyHp = document.createElement("button");

            btnApplyHp.type = "button";
            btnApplyHp.textContent = "HP 적용";

            btnApplyHp.addEventListener("click", (e) => {

                e.stopPropagation();

                BattleManager.setCharacterHp(battle.id, character.id, hpInput.value);

                renderAllBattles();

            });

            row.appendChild(hpInput);
            row.appendChild(btnApplyHp);

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

        wrapper.appendChild(row);

        // ★ 추가: 감염 부위 수동 관리 영역
        const infectionRow = document.createElement("div");

        infectionRow.style.marginTop = "4px";
        infectionRow.style.display = "flex";
        infectionRow.style.alignItems = "center";
        infectionRow.style.flexWrap = "wrap";
        infectionRow.style.gap = "6px";

        const infectionLabel = document.createElement("span");

        infectionLabel.style.color = "#a55";

        infectionLabel.textContent = character.infections.length > 0
            ? `감염부위: `
            : `감염 없음`;

        infectionRow.appendChild(infectionLabel);

        character.infections.forEach((infection, index) => {

            const tag = document.createElement("span");

            tag.style.background = "#402020";
            tag.style.padding = "2px 6px";
            tag.style.borderRadius = "3px";
            tag.style.display = "inline-flex";
            tag.style.alignItems = "center";
            tag.style.gap = "4px";

            tag.textContent = `${infection.part} (${infection.round}R)`;

            if (battle.status === "ongoing") {

                const btnRemove = document.createElement("button");

                btnRemove.type = "button";
                btnRemove.textContent = "✕";
                btnRemove.title = "감염 제거";
                btnRemove.style.fontSize = "10px";

                btnRemove.addEventListener("click", (e) => {

                    e.stopPropagation();

                    BattleManager.removeCharacterInfection(battle.id, character.id, index);

                    renderAllBattles();

                });

                tag.appendChild(btnRemove);

            }

            infectionRow.appendChild(tag);

        });

        if (battle.status === "ongoing") {

            const partSelect = document.createElement("select");

            BattleManager.BODY_PARTS.forEach(part => {

                const option = document.createElement("option");

                option.value = part;
                option.textContent = part;

                partSelect.appendChild(option);

            });

            const btnAddInfection = document.createElement("button");

            btnAddInfection.type = "button";
            btnAddInfection.textContent = "감염 추가";

            btnAddInfection.addEventListener("click", (e) => {

                e.stopPropagation();

                BattleManager.addCharacterInfection(battle.id, character.id, partSelect.value);

                renderAllBattles();

            });

            infectionRow.appendChild(partSelect);
            infectionRow.appendChild(btnAddInfection);

        }

        wrapper.appendChild(infectionRow);

        charListEl.appendChild(wrapper);

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

        // ★ 추가: 회피 보조 대상 후보 (자기 자신 제외, 생존 캐릭터만)
        const allyOptions = aliveCharacters
            .filter(c => c.id !== character.id)
            .map(c => `<option value="${c.id}">${c.name}</option>`)
            .join("");

        row.innerHTML = `
            <b>${character.name}</b>
            <select class="actionType">
                <option value="attack">공격(근력)</option>
                <option value="evade">회피/도주(민첩)</option>
                <option value="specialty">특기</option>
                <option value="assistEvade">회피 보조</option>
                <option value="none">행동 안 함</option>
            </select>
            <select class="actionTargetZombie">
                ${zombieOptions}
            </select>
            <select class="actionTargetCharacter" style="display:none;">
                ${allyOptions || `<option value="">보조 가능한 대상 없음</option>`}
            </select>
        `;

        const actionTypeSelect = row.querySelector(".actionType");

        const targetZombieSelect = row.querySelector(".actionTargetZombie");

        const targetCharacterSelect = row.querySelector(".actionTargetCharacter");

        const syncTargetVisibility = () => {

            targetZombieSelect.style.display =
                actionTypeSelect.value === "attack" ? "" : "none";

            targetCharacterSelect.style.display =
                actionTypeSelect.value === "assistEvade" ? "" : "none";

        };

        actionTypeSelect.addEventListener("change", syncTargetVisibility);

        syncTargetVisibility(); // 초기 상태 반영

        wrap.appendChild(row);

    });

    const btnResolve = document.createElement("button");

    btnResolve.textContent = "라운드 진행";

    btnResolve.addEventListener("click", () => {

        const actions = {};

        wrap.querySelectorAll(".action-row").forEach(row => {

            const characterId = row.dataset.characterId;

            const type = row.querySelector(".actionType").value;

            const targetZombieId = row.querySelector(".actionTargetZombie").value;

            // ★ 추가: 회피 보조 대상 캐릭터 id
            const targetCharacterId = row.querySelector(".actionTargetCharacter").value;

            if (type === "assistEvade" && !targetCharacterId) {

                actions[characterId] = { type: "none" };

                return;

            }

            actions[characterId] = { type, targetZombieId, targetCharacterId };

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
