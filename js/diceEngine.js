// ============================================
// diceEngine.js
// Character Manager Dice Engine
// ============================================

const DiceEngine = (() => {

    // ----------------------------------------
    // 스탯 기준치
    // ----------------------------------------

    const STAT_TABLE = {

        1: 20,
        2: 35,
        3: 50,
        4: 65,
        5: 80

    };

    // ----------------------------------------
    // 스탯 → 기준치
    // ----------------------------------------

    function getTarget(statLevel) {

        return STAT_TABLE[statLevel] ?? 20;

    }

    // ----------------------------------------
    // 1D100
    // ----------------------------------------

    function rollD100() {

        return Math.floor(Math.random() * 100) + 1;

    }

    // ----------------------------------------
    // 성공 단계 계산
    // ----------------------------------------

    function judge(dice, target) {

        if (dice === 1) {

            return {
                success: true,
                rank: "대성공"
            };

        }

        if (dice >= 99) {

            return {
                success: false,
                rank: "대실패"
            };

        }

        if (dice <= Math.floor(target / 5)) {

            return {
                success: true,
                rank: "극단적 성공"
            };

        }

        if (dice <= Math.floor(target / 2)) {

            return {
                success: true,
                rank: "어려운 성공"
            };

        }

        if (dice <= target) {

            return {
                success: true,
                rank: "성공"
            };

        }

        return {

            success: false,

            rank: "실패"

        };

    }

    // ----------------------------------------
    // 스탯 판정
    // ----------------------------------------

    function roll(statLevel) {

        const target = getTarget(statLevel);

        const dice = rollD100();

        const result = judge(

            dice,

            target

        );

        return {

            dice,

            target,

            stat: statLevel,

            success: result.success,

            rank: result.rank

        };

    }

    // ----------------------------------------
    // 캐릭터 판정
    // ----------------------------------------

    function rollCharacter(character, statName) {

        const statLevel =

            character.stats[statName];

        const result = roll(statLevel);

        return {

            name: character.name,

            profile: character.profile,

            statName,

            statLevel,

            ...result

        };

    }

    // ----------------------------------------
    // 여러 명 동시 판정
    // ----------------------------------------

    function rollMultiple(characters, statName) {

        return characters.map(character =>

            rollCharacter(

                character,

                statName

            )

        );

    }

    // ----------------------------------------
    // 랜덤 선택
    // ----------------------------------------

    function randomChoice(array) {

        if (array.length === 0)

            return null;

        const index =

            Math.floor(

                Math.random()

                * array.length

            );

        return array[index];

    }

    // ----------------------------------------
    // N면체 다이스
    // ----------------------------------------

    function rollDice(face) {

        return Math.floor(

            Math.random()

            * face

        ) + 1;

    }

    // ----------------------------------------
    // 여러 개 다이스
    // ----------------------------------------

    function rollMany(face, count) {

        const list = [];

        let total = 0;

        for (let i = 0; i < count; i++) {

            const value = rollDice(face);

            list.push(value);

            total += value;

        }

        return {

            list,

            total

        };

    }

    // ----------------------------------------
    // 성공 여부만
    // ----------------------------------------

    function isSuccess(statLevel) {

        return roll(statLevel).success;

    }

    // ----------------------------------------
    // 퍼센트 출력
    // ----------------------------------------

    function getSuccessRate(statLevel) {

        return getTarget(statLevel);

    }

    // ----------------------------------------
    // 로그 문자열
    // ----------------------------------------

    function resultText(result) {

        return

`${result.dice} / ${result.target} → ${result.rank}`;

    }

    // ----------------------------------------
    // 반환
    // ----------------------------------------

    return {

        STAT_TABLE,

        getTarget,

        rollD100,

        judge,

        roll,

        rollCharacter,

        rollMultiple,

        randomChoice,

        rollDice,

        rollMany,

        isSuccess,

        getSuccessRate,

        resultText

    };

})();

console.log("Dice Engine Ready");