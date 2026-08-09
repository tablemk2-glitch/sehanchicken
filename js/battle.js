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
    
        // ★ 추가: 이전 버전 데이터 호환 (phase 필드 없을 경우 기본값 채움)
        battles.forEach(b => {
            if (!b.phase) b.phase = "start";
        });
    
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
            name: getZombieDisplayName(zombie),
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

    // ★ 추가: 좀비 표시 이름 통일 (전환된 캐릭터는 원래 이름, 일반 좀비는 "좀비 N")
    function getZombieDisplayName(zombie) {
        return zombie.isTurnedCharacter ? zombie.name : `좀비 ${zombie.id}`;
}
    
    // 전환된 캐릭터는 원래 스탯(character.stats)을 그대로 사용, 일반 좀비는 기존처럼 고정 스탯 사용

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
    
        phase: "start", // ★ 추가: "start"(행동 입력 대기) | "targeted"(좀비 지목 완료, 좀비 페이즈 대기)
    
        zombies,
    
        characters: battleCharacters,
    
        log: [],
    
        // ★ 추가: 1단계 → 2단계 사이에 필요한 임시 상태 (2단계 종료 시 초기화)
        pendingZombieTargets: null,
        pendingAssistedIds: null,
        pendingAssistingIds: null,
        pendingSelfDodgeIds: null,  // ★ 추가
        pendingSummary: null
    
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

    // ★ 추가: 생존 + 이미 전투 합류 완료(대기 라운드 아님) 여부
    function isCharacterActive(battle, character) {
    
        return character.status === "alive"
            && (!character.joinRound || battle.round >= character.joinRound);
    
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

        const zombieDisplayName = getZombieDisplayName(zombie);

        if (zombie.hits >= zombie.requiredHits) {

            zombie.alive = false;

            log.push(`  → ${zombieDisplayName} 전투불능!`);

        }

        else {

            log.push(`  → ${zombieDisplayName} 피해 누적 (${zombie.hits}/${zombie.requiredHits})`);

        }

    }

// 변경 후
function resolveFlee(character, log, summary) {

    const result = rollStat(character, "agility");

    log.push(`- ${character.name} 도주(민첩) 판정 ${formatRoll(result)}`);

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
        log.push(`  → 도주 대실패! 추가 페널티로 HP -1 (남은 HP ${character.hp}/${character.maxHp})`);

        if (character.hp <= 0 && character.status === "alive") {
            character.status = "down";
            log.push(`  → ${character.name} 전투불능!`);
        }
    }

}

// ★ 신규: 회피는 전투 이탈 없이 이번 라운드 공격만 회피
function resolveDodge(character, log, summary, guaranteedEvadeIds, selfDodgeIds) {

    const result = rollStat(character, "agility");

    log.push(`- ${character.name} 회피(민첩) 판정 ${formatRoll(result)}`);

    if (summary) {
        summary.dodges.push(`${character.name} 회피(민첩) 판정 ${formatRoll(result)}`);
    }

    if (result.success) {
        guaranteedEvadeIds.add(character.id);
        selfDodgeIds.add(character.id);
        log.push(`  → 회피 성공, 이번 라운드 공격 자동 회피`);
        return;
    }

    log.push(`  → 회피 실패, 전투 지속`);

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
// 전투 중간 캐릭터 합류 (비동기: Firestore에서 원본 로드)
// ============================================

async function addCharacterToBattle(battleId, characterId) {

    const battle = getBattle(battleId);

    if (!battle || battle.status !== "ongoing") return null;

    if (battle.characters.some(c => String(c.id) === String(characterId))) {
        return battle; // 이미 참여 중
    }

    const source = await getCharacters();

    const original = source.find(c => String(c.id) === String(characterId));

    if (!original) return null;

    const newCharacter = {

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

        infections: [],

        joinRound: battle.round + 1 // ★ 다음 라운드부터 행동 가능

    };

    battle.characters.push(newCharacter);

    battle.log.push(`➕ ${newCharacter.name}이(가) 전투에 합류했습니다. (${newCharacter.joinRound}라운드부터 행동 가능)`);

    saveBattles();

    return battle;

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
        
            const displayName = getZombieDisplayName(zombie);
        
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
// 캐릭터 전투 참여 인원에서 임시 이탈 처리 (진행자용)
// ============================================

function removeCharacterFromBattle(battleId, characterId) {

    const battle = getBattle(battleId);
    if (!battle) return null;
    const character = battle.characters.find(c => c.id === characterId);
    if (!character) return null;

    character.status = "removed";
    battle.log.push(`➖ ${character.name}이(가) 전투에서 임시 이탈했습니다.`);

    saveBattles();
    return battle;

}

// ★ 신규: 임시 이탈한 캐릭터 복귀
function returnCharacterToBattle(battleId, characterId) {

    const battle = getBattle(battleId);
    if (!battle) return null;
    const character = battle.characters.find(c => c.id === characterId);
    if (!character) return null;

    if (character.status !== "removed") return battle;

    character.status = "alive";
    battle.log.push(`↩ ${character.name}이(가) 전투에 복귀했습니다.`);

    saveBattles();
    return battle;

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


// ★ 변경: 좀비 지목만 담당, 로그는 그룹핑 후 별도로 처리 (여기서 직접 로그하지 않음)
function pickZombieTarget(battle, zombie) {

    const aliveCharacters = battle.characters.filter(c => isCharacterActive(battle, c));

    if (aliveCharacters.length === 0) {
        return { zombieId: zombie.id, targetCharacterId: null };
    }

    const target = DiceEngine.randomChoice(aliveCharacters);

    return { zombieId: zombie.id, targetCharacterId: target.id };

}

// ★ 추가: 같은 대상을 지목한 좀비들을 묶어서 로그 라인 생성
// 예) "- 좀비 #1, 좀비 #2, 좀비 #3 → 홍길동을(를) 지목!"
function buildZombieTargetLogLines(battle, targets) {

    const lines = [];
    const groups = new Map(); // targetCharacterId(문자열) 또는 "__none__" → 좀비 표기명 배열

    targets.forEach(({ zombieId, targetCharacterId }) => {
    
        const zombie = battle.zombies.find(z => String(z.id) === String(zombieId));
    
        // zombie를 못 찾는 경우(비정상 상황)만 예외적으로 직접 조립, 나머진 헬퍼 사용
        const zombieDisplayName = zombie
            ? getZombieDisplayName(zombie)
            : `좀비 ${zombieId}`;
    
        const key = targetCharacterId ? String(targetCharacterId) : "__none__";
    
        if (!groups.has(key)) groups.set(key, []);
    
        groups.get(key).push(zombieDisplayName);
    
    });

    groups.forEach((zombieNames, key) => {

        const namesText = zombieNames.join(", ");

        if (key === "__none__") {

            lines.push(`- ${namesText}: 공격 가능한 대상 없음`);

        } else {

            const target = battle.characters.find(c => String(c.id) === key);

            lines.push(`- ${namesText} → ${target ? target.name : "알 수 없음"}을(를) 지목!`);

        }

    });

    return lines;

}

    
// ★ 변경: 지목된 대상에 대한 실제 공격 판정/피해 적용 (2단계에서 호출)
function resolveZombieAttackResolution(battle, zombie, targetCharacterId, log, summary, assistedIds, assistingIds, selfDodgeIds) {

    const zombieDisplayName = getZombieDisplayName(zombie);

    if (!targetCharacterId) {
        return; // 지목 당시 대상 없음은 1단계에서 이미 로그됨
    }

    const target = battle.characters.find(c => c.id === targetCharacterId && c.status === "alive");

    if (!target) {

        log.push(`- ${zombieDisplayName}: 지목했던 대상이 더 이상 유효하지 않아 공격 취소`);

        return;

    }

    const zombieStatObj = getZombieStatObject(zombie);

    const attackResult = rollStat(zombieStatObj, "strength");

    log.push(`- ${zombieDisplayName} → ${target.name} 공격 판정 ${formatRoll(attackResult)}`);

    if (summary) {
        summary.zombieAttacks.push(`${zombieDisplayName} 공격 판정 ${formatRoll(attackResult)}`);
    }

    if (!attackResult.success) {
        log.push(`  → 빗나감`);
        return;
    }

            if (assistedIds && assistedIds.has(target.id)) {
        
                const isSelfDodge = selfDodgeIds && selfDodgeIds.has(target.id);
        
                log.push(
                    isSelfDodge
                        ? `  → ${target.name}은(는) 스스로 회피에 성공해 자동 회피! 피해 없음`
                        : `  → ${target.name}은(는) 동료의 회피 보조를 받아 자동 회피 성공! 피해 없음`
                );
        
                if (summary) {
                    summary.evades.push(
                        isSelfDodge
                            ? `${target.name} 회피 자동 성공 (자력 회피)`
                            : `${target.name} 회피 자동 성공 (동료 보조)`
                    );
                }
        
                return;
            }

    if (assistingIds && assistingIds.has(target.id)) {
        log.push(`  → ${target.name}은(는) 동료를 보조하느라 자신을 방어하지 못해 자동으로 피격!`);
        if (summary) summary.evades.push(`${target.name} 회피 자동 실패 (동료 보조 중)`);
        applyZombieHit(battle, target, attackResult, log, summary);
        return;
    }

    const evadeResult = rollStat(target, "agility");

    log.push(`  → ${target.name} 회피 판정 ${formatRoll(evadeResult)}`);

    if (summary) summary.evades.push(`${target.name} 회피(민첩) 판정 ${formatRoll(evadeResult)}`);

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

        // ============================================
        // 1단계: 러너 페이즈 + 좀비 지목
        // ============================================
        
        function resolveRunnerAndTargetPhase(battleId, actions, skipRunnerPhase) {
        
            const battle = getBattle(battleId);
        
            if (!battle || battle.status !== "ongoing") return battle;
        
            if ((battle.phase || "start") !== "start") return battle; // 이미 1단계 완료됨
        
            const log = [];
        
            const summary = {
                attacks: [], flees: [], dodges: [], assists: [], zombieAttacks: [], evades: [], lucks: []
            };
        
            const assistedCharacterIds = new Set();
            const assistingCharacterIds = new Set();
            const selfDodgeIds = new Set(); // ★ 추가
        
            log.push(`===== ${battle.round} 라운드 =====`);
        
            if (!skipRunnerPhase) {
        
                log.push(`[러너 페이즈]`);
        
                //대기
                battle.characters.forEach(character => {
                
                    if (character.status !== "alive") return;
                
                    if (!isCharacterActive(battle, character)) {
                        log.push(`- ${character.name}: 전투 합류 대기 중 (${character.joinRound}라운드부터 행동 가능)`);
                        return;
                    }
                
                    const action = actions[character.id];
                        
                    if (!action || action.type === "none") {
                        log.push(`- ${character.name}: 행동 없음`);
                        return;
                    }
        
                    if (action.type === "attack") {
        
                        resolveAttack(battle, character, action.targetZombieId, log, summary);
        
                    }
        
                    else if (action.type === "flee") {
                        resolveFlee(character, log, summary);
                    }
                    
                    else if (action.type === "dodge") {
                        resolveDodge(character, log, summary, assistedCharacterIds, selfDodgeIds);
                    }
        
                    else if (action.type === "specialty") {
                        resolveSpecialty(character, log);
                    }
        
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
        
                        assistingCharacterIds.add(character.id);
        
                        const assistSuccess = resolveAssistEvade(character, targetCharacter, log, summary);
        
                        if (assistSuccess) {
                            assistedCharacterIds.add(targetCharacter.id);
                        }
                    }
                });
        
            } else {
        
                log.push(`[러너 페이즈 생략 - 좀비 선공]`);
        
            }
        
            // ★ 러너 선공이든 좀비 선공이든, 여기서 항상 "좀비 지목"까지만 진행

            log.push(`[좀비 지목]`);
            
                const targets = [];
            
                battle.zombies.forEach(zombie => {
                    if (!zombie.alive) return;
                    targets.push(pickZombieTarget(battle, zombie)); // ★ log 인자 제거
                });
            
                log.push(...buildZombieTargetLogLines(battle, targets)); // ★ 그룹핑된 로그 추가

            
            battle.log.push(...log);
        
            battle.phase = "targeted";
            battle.pendingZombieTargets = targets;
            battle.pendingAssistedIds = Array.from(assistedCharacterIds);
            battle.pendingAssistingIds = Array.from(assistingCharacterIds);
            battle.pendingSelfDodgeIds = Array.from(selfDodgeIds); 
            battle.pendingSummary = summary;
        
            saveBattles();
        
            return battle;
        
        }

    // ============================================
    // 1.5단계: 좀비 지목 공개 후 반응 행동 처리
    // ============================================
    
function resolveReactionPhase(battleId, actions) {

    const battle = getBattle(battleId);

    if (!battle || battle.status !== "ongoing") return battle;

    if (battle.phase !== "targeted") return battle;

    const log = [];

    log.push(`[반응 페이즈 - 좀비 지목 공개 후 행동 선택]`);

    const actionLabels = {
        attack: "공격",
        flee: "도주",
        dodge: "회피",
        specialty: "특기 사용",
        assistEvade: "회피 보조"
    };

    battle.characters.forEach(character => {

        if (character.status !== "alive") return;

        if (!isCharacterActive(battle, character)) {
            log.push(`- ${character.name}: 전투 합류 대기 중 (${character.joinRound}라운드부터 행동 가능)`);
            return;
        }

        const action = actions[character.id];

        if (!action || action.type === "none") {
            log.push(`- ${character.name}: 반응 행동 없음`);
            return;
        }

        let desc = `- ${character.name}: ${actionLabels[action.type] || action.type} 선택`;

        if (action.type === "attack") {
            const zombie = battle.zombies.find(z => String(z.id) === String(action.targetZombieId));
            const zombieName = zombie ? getZombieDisplayName(zombie) : "알 수 없음";
            desc += ` (대상: ${zombieName})`;
        }

        else if (action.type === "assistEvade") {
            const targetCharacter = battle.characters.find(c => String(c.id) === String(action.targetCharacterId));
            desc += ` (대상: ${targetCharacter ? targetCharacter.name : "알 수 없음"})`;
        }

        desc += ` (판정은 좀비 페이즈에서 진행)`;

        log.push(desc);

    });

    battle.log.push(...log);

    battle.phase = "reacted";
    battle.pendingReactionActions = actions; // ★ 판정은 나중에(좀비 페이즈에서) 진행

    saveBattles();

    return battle;

}
    
    // ============================================
    // 2단계: 좀비 페이즈 해결 + 라운드 종료
    // ============================================
        
 function resolveZombiePhase(battleId) {

    const battle = getBattle(battleId);

    if (!battle || battle.status !== "ongoing") return battle;

    if (battle.phase !== "reacted") return battle;

    const log = [];

    const summary = battle.pendingSummary || {
        attacks: [], flees: [], dodges: [], assists: [], zombieAttacks: [], evades: [], lucks: []
    };

    const assistedIds = new Set(battle.pendingAssistedIds || []);
    const assistingIds = new Set(battle.pendingAssistingIds || []);
    const selfDodgeIds = new Set(battle.pendingSelfDodgeIds || []);

    // ★ 반응 페이즈에서 "선택"만 해뒀던 행동을 여기서 실제로 판정
    const reactionActions = battle.pendingReactionActions || {};

    log.push(`[반응 행동 판정]`);

    battle.characters.forEach(character => {

        if (character.status !== "alive") return;

        if (!isCharacterActive(battle, character)) return;

        const action = reactionActions[character.id];

        // 행동 없음 / dodge는 여기서 따로 판정하지 않음
        // → dodge는 아래 좀비 공격 판정 시 회피 대항 판정으로 자연스럽게 비교됨
        if (!action || action.type === "none" || action.type === "dodge") return;

        if (action.type === "attack") {
            resolveAttack(battle, character, action.targetZombieId, log, summary);
        }

        else if (action.type === "flee") {
            resolveFlee(character, log, summary);
        }

        else if (action.type === "specialty") {
            resolveSpecialty(character, log);
        }

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

            assistingIds.add(character.id);

            const assistSuccess = resolveAssistEvade(character, targetCharacter, log, summary);

            if (assistSuccess) {
                assistedIds.add(targetCharacter.id);
            }
        }

    });

    log.push(`[좀비 페이즈]`);

    (battle.pendingZombieTargets || []).forEach(({ zombieId, targetCharacterId }) => {

        const zombie = battle.zombies.find(z => String(z.id) === String(zombieId) && z.alive);

        if (!zombie) return;

        resolveZombieAttackResolution(battle, zombie, targetCharacterId, log, summary, assistedIds, assistingIds, selfDodgeIds);

    });

    // ----- 라운드 요약 (기존과 동일) -----
    log.push(`----- ${battle.round}라운드 판정 요약 -----`);

    if (summary.attacks.length > 0) {
        log.push(`러너 페이즈`);
        summary.attacks.forEach(entry => log.push(entry));
    }

    if (summary.flees.length > 0) {
        log.push(`캐릭터 도주`);
        summary.flees.forEach(entry => log.push(entry));
    }

    if (summary.dodges.length > 0) {
        log.push(`캐릭터 회피 시도`);
        summary.dodges.forEach(entry => log.push(entry));
    }

    if (summary.assists.length > 0) {
        log.push(`회피 보조`);
        summary.assists.forEach(entry => log.push(entry));
    }

    if (summary.zombieAttacks.length > 0) {
        log.push(`좀비 페이즈`);
        summary.zombieAttacks.forEach(entry => log.push(entry));
    }

    if (summary.evades.length > 0) {
        log.push(`캐릭터 회피`);
        summary.evades.forEach(entry => log.push(entry));
    }

    if (summary.lucks.length > 0) {
        log.push(`캐릭터 행운`);
        summary.lucks.forEach(entry => log.push(entry));
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

    battle.phase = "start";
    battle.pendingZombieTargets = null;
    battle.pendingAssistedIds = null;
    battle.pendingAssistingIds = null;
    battle.pendingSelfDodgeIds = null;
    battle.pendingReactionActions = null; // ★ 추가: 초기화
    battle.pendingSummary = null;

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
        resolveRunnerAndTargetPhase,
        resolveReactionPhase,
        resolveZombiePhase,
        rollStat,
        pickRandomBodyPart,
        getZombieDisplayName,
        convertCharacterToZombieEnemy,
        removeCharacterFromBattle,
        returnCharacterToBattle, 
        addCharacterToBattle,   // ★ 추가
        isCharacterActive,      // ★ 추가 (UI에서 대기 상태 판단용)
        setZombieHits,
        setCharacterHp,
        addCharacterInfection,
        removeCharacterInfection,
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
        const card = renderBattleCard(battle);
        area.appendChild(card);
        restoreBattleLogScroll(battle, card); // ★ 추가
    });
}

// ★ 추가: 재렌더링 후 로그박스 스크롤 위치 복원
function restoreBattleLogScroll(battle, card) {
    const logBox = card.querySelector(".battle-log");
    if (!logBox) return;

    const saved = battleLogScrollState.get(battle.id);

    if (!saved || saved.atBottom) {
        // 저장된 위치가 없거나(최초 렌더) 원래 맨 아래를 보고 있었다면 → 최신 로그로 계속 따라감
        logBox.scrollTop = logBox.scrollHeight;
    } else {
        // 과거 기록을 읽던 중이었다면 → 그 위치 그대로 유지
        logBox.scrollTop = saved.scrollTop;
    }
}

const collapsedBattleIds = new Set();
const battleLogScrollState = new Map(); // ★ 추가: battleId -> { scrollTop, atBottom }

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
        const zombieLabel = getZombieDisplayName(zombie);

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

        // 변경 후
        const statusText2 = {
            alive: "생존",
            fled: "도주",
            down: "전투불능",
            removed: "임시 이탈"
        }[character.status];
        
        const isWaitingToJoin = character.joinRound && battle.round < character.joinRound;
        
        const infoSpan = document.createElement("span");
        
        infoSpan.textContent =
            `${character.name} - HP ${character.hp}/${character.maxHp} `
            + `(${statusText2}${isWaitingToJoin ? `, ${character.joinRound}라운드부터 합류` : ""})`;

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


            if (character.status !== "removed") {

                const btnRemove = document.createElement("button");

                btnRemove.type = "button";
                btnRemove.className = "btnRemoveFromBattle";
                btnRemove.textContent = "➖ 임시 이탈";

                btnRemove.addEventListener("click", (e) => {

                    e.stopPropagation();

                    if (!confirm(`${character.name}을(를) 전투에서 임시 이탈시키겠습니까?\n(HP/감염 기록은 유지되며 나중에 복귀 가능합니다)`)) {
                        return;
                    }

                    BattleManager.removeCharacterFromBattle(battle.id, character.id);

                    renderAllBattles();

                });

                row.appendChild(btnRemove);

            } else {

                const btnReturn = document.createElement("button");

                btnReturn.type = "button";
                btnReturn.className = "btnReturnToBattle";
                btnReturn.textContent = "↩ 전투 복귀";

                btnReturn.addEventListener("click", (e) => {

                    e.stopPropagation();

                    BattleManager.returnCharacterToBattle(battle.id, character.id);

                    renderAllBattles();

                });

                row.appendChild(btnReturn);

            }
            

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
    
        const addCharWrap = document.createElement("div");
    
        addCharWrap.className = "add-character-wrap";
        addCharWrap.style.marginTop = "12px";
    
        addCharWrap.innerHTML = `
            <h3>전투 참여 캐릭터 추가</h3>
            <select class="addCharacterSelect"><option value="">불러오는 중...</option></select>
            <button type="button" class="btnAddCharacter">추가 (다음 라운드부터 행동 가능)</button>
        `;
    
        const addSelect = addCharWrap.querySelector(".addCharacterSelect");
        const btnAdd = addCharWrap.querySelector(".btnAddCharacter");
    
        getCharacters().then(allCharacters => {
    
            const existingIds = new Set(battle.characters.map(c => String(c.id)));
    
            const available = allCharacters.filter(c => !existingIds.has(String(c.id)));
    
            addSelect.innerHTML = available.length > 0
                ? available.map(c => `<option value="${c.id}">${c.name}</option>`).join("")
                : `<option value="">추가 가능한 캐릭터 없음</option>`;
    
        });
    
        btnAdd.addEventListener("click", async (e) => {
    
            e.stopPropagation();
    
            const characterId = addSelect.value;
    
            if (!characterId) return;
    
            btnAdd.disabled = true;
    
            try {
    
                await BattleManager.addCharacterToBattle(battle.id, characterId);
    
                renderAllBattles();
    
            }
    
            catch (error) {
    
                alert("캐릭터 추가 중 오류가 발생했습니다.");
                console.error(error);
    
            }
    
            finally {
    
                btnAdd.disabled = false;
    
            }
    
        });
    
        bodyEl.appendChild(addCharWrap);
    
    }
    
    
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
    
    // ★ 추가: 스크롤 위치 기억 (사용자가 위로 스크롤해서 과거 로그를 보는 중인지 추적)
    logBox.addEventListener("scroll", () => {
        const atBottom = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 4;
        battleLogScrollState.set(battle.id, { scrollTop: logBox.scrollTop, atBottom });
    });
    
    bodyEl.appendChild(logBox);
    return card;

}

// ----------------------------------------
// 라운드 행동 선택 UI
// ----------------------------------------

//헬퍼 
function getZombieDisplayName(zombie) {
    return BattleManager.getZombieDisplayName(zombie);
}

function createActionRow(character, aliveZombies, aliveCharacters) {

    const row = document.createElement("div");

    row.className = "action-row";

    row.dataset.characterId = character.id;

    const zombieOptions = aliveZombies
        .map(z => `<option value="${z.id}">${getZombieDisplayName(z)}</option>`)
        .join("");

    const allyOptions = aliveCharacters
        .filter(c => c.id !== character.id)
        .map(c => `<option value="${c.id}">${c.name}</option>`)
        .join("");

    row.innerHTML = `
        <b>${character.name}</b>
        <select class="actionType">
            <option value="attack">공격(근력)</option>
            <option value="dodge">회피(민첩)</option>
            <option value="flee">도주(민첩)</option>
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
        targetZombieSelect.style.display = actionTypeSelect.value === "attack" ? "" : "none";
        targetCharacterSelect.style.display = actionTypeSelect.value === "assistEvade" ? "" : "none";
    };

    actionTypeSelect.addEventListener("change", syncTargetVisibility);
    syncTargetVisibility();

    return row;

}

function collectActionsFromRows(wrap) {

    const actions = {};

    wrap.querySelectorAll(".action-row").forEach(row => {

        const characterId = row.dataset.characterId;
        const type = row.querySelector(".actionType").value;
        const targetZombieId = row.querySelector(".actionTargetZombie").value;
        const targetCharacterId = row.querySelector(".actionTargetCharacter").value;

        if (type === "assistEvade" && !targetCharacterId) {
            actions[characterId] = { type: "none" };
            return;
        }

        actions[characterId] = { type, targetZombieId, targetCharacterId };

    });

    return actions;

} 
//헬퍼

function renderRoundControls(battle) {

    const wrap = document.createElement("div");

    wrap.className = "round-controls";

    const aliveCharacters = battle.characters.filter(c => BattleManager.isCharacterActive(battle, c));
    const aliveZombies = battle.zombies.filter(z => z.alive);

    // ★ 3단계 대기: 반응 행동까지 끝났고 좀비 페이즈만 남음
    if (battle.phase === "reacted") {

        wrap.innerHTML = `
            <h3>이번 라운드 행동</h3>
            <p>반응 행동까지 모두 처리되었습니다. 좀비 페이즈를 진행하세요.</p>
        `;

        const btnResolveZombie = document.createElement("button");
        btnResolveZombie.textContent = "좀비 페이즈 진행";

        btnResolveZombie.addEventListener("click", () => {
            BattleManager.resolveZombiePhase(battle.id);
            renderAllBattles();
        });

        wrap.appendChild(btnResolveZombie);
        return wrap;

    }

    // ★ 2단계 대기: 좀비 지목 공개 후 반응 행동 선택
    if (battle.phase === "targeted") {

        wrap.innerHTML = `<h3>좀비 지목 결과</h3>`;

        const targetList = document.createElement("ul");
        const targetGroups = new Map(); // key → 좀비 표기명 배열

        (battle.pendingZombieTargets || []).forEach(({ zombieId, targetCharacterId }) => {

            const zombie = battle.zombies.find(z => String(z.id) === String(zombieId));
            const zombieName = zombie ? getZombieDisplayName(zombie) : "알 수 없는 좀비";

            const key = targetCharacterId ? String(targetCharacterId) : "__none__";

            if (!targetGroups.has(key)) targetGroups.set(key, []);
            targetGroups.get(key).push(zombieName);

        });

        targetGroups.forEach((zombieNames, key) => {

            const li = document.createElement("li");

            if (key === "__none__") {
                li.textContent = `${zombieNames.join(", ")} → 대상 없음`;
            } else {
                const target = battle.characters.find(c => String(c.id) === key);
                li.textContent = `${zombieNames.join(", ")} → ${target ? target.name : "알 수 없음"}`;
            }
            targetList.appendChild(li);
        });

        wrap.appendChild(targetList);


        const reactionHeading = document.createElement("h3");
        reactionHeading.textContent = "반응 행동 선택";
        wrap.appendChild(reactionHeading);

        aliveCharacters.forEach(character => {
            wrap.appendChild(createActionRow(character, aliveZombies, aliveCharacters));
        });

        const btnResolveReaction = document.createElement("button");
        btnResolveReaction.textContent = "반응 행동 확정/좀비 페이즈 진행";

        btnResolveReaction.addEventListener("click", () => {
            const actions = collectActionsFromRows(wrap);
            BattleManager.resolveReactionPhase(battle.id, actions);
            BattleManager.resolveZombiePhase(battle.id); // ★ 반응 행동 확정과 동시에 좀비 페이즈까지 이어서 진행
            renderAllBattles();
        });

        wrap.appendChild(btnResolveReaction);
        return wrap;

    }

    // ★ 1단계 대기: 행동 입력 (기존과 동일, 행동 열 생성만 헬퍼로 교체)
    wrap.innerHTML = `<h3>이번 라운드 행동</h3>`;

    const skipRow = document.createElement("label");
    skipRow.innerHTML = `
        <input type="checkbox" class="skipRunnerPhase">
        러너 공격 생략 (좀비 선공)
    `;
    wrap.appendChild(skipRow);

    const skipCheckbox = skipRow.querySelector(".skipRunnerPhase");

    aliveCharacters.forEach(character => {
        wrap.appendChild(createActionRow(character, aliveZombies, aliveCharacters));
    });

    const btnResolve = document.createElement("button");

    const updateResolveButtonLabel = () => {
        btnResolve.textContent = skipCheckbox.checked
            ? "좀비 지목 확인 (좀비 선공)"
            : "1단계 진행 (러너 페이즈 → 좀비 지목)";
    };

    skipCheckbox.addEventListener("change", updateResolveButtonLabel);
    updateResolveButtonLabel();

    btnResolve.addEventListener("click", () => {
        const actions = collectActionsFromRows(wrap);
        const skipRunnerPhase = skipCheckbox.checked;
        BattleManager.resolveRunnerAndTargetPhase(battle.id, actions, skipRunnerPhase);
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
