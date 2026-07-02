// ============================================
// dice.js (Firebase Firestore 버전)
// ============================================
document.addEventListener("DOMContentLoaded", () => {
    loadCharacterList();
    document
        .getElementById("btnRoll")
        .addEventListener("click", rollSelected);
    document
        .getElementById("btnCopyResult")
        .addEventListener("click", copyResultText);
});
// ----------------------------------------
// 스탯 이름 변환
// ----------------------------------------
const statNames = {
    strength: "근력",
    agility: "민첩",
    intelligence: "지능",
    luck: "행운",
    specialty: "특기"
};
// ----------------------------------------
// 캐릭터 간략 정보 텍스트 생성
// ----------------------------------------
function buildCharacterPreview(character) {
    const stats = character.stats;
    const parts = [
        `근력 ${stats.strength}`,
        `민첩 ${stats.agility}`,
        `지능 ${stats.intelligence}`,
        `행운 ${stats.luck}`
    ];
    if (character.specialty) {
        parts.push(`특기 ${character.specialty}`);
    }
    return parts.join(" · ");
}
// ----------------------------------------
// 선택된 캐릭터 id 저장소
// ----------------------------------------
const selectedCharacterIds = new Set();
// ----------------------------------------
// 캐릭터 목록 캐시 (판정 시 다시 불러오지 않기 위함)
// ----------------------------------------
let cachedCharacters = [];
// ----------------------------------------
// 캐릭터 목록 출력 (버튼 방식)
// ----------------------------------------
async function loadCharacterList() {
    const list = document.getElementById("characterList");
    list.innerHTML = "<p>불러오는 중...</p>";
    selectedCharacterIds.clear();

    cachedCharacters = await getCharacters();

    list.innerHTML = "";

    if (cachedCharacters.length === 0) {
        list.innerHTML = "<p>등록된 캐릭터가 없습니다.</p>";
        return;
    }

    cachedCharacters.forEach(character => {
        const row = document.createElement("div");
        row.className = "character-select-row";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "character-select-item";
        btn.textContent = character.name;

        const preview = document.createElement("div");
        preview.className = "character-preview";
        preview.style.display = "none";
        preview.textContent = buildCharacterPreview(character);

        btn.addEventListener("click", () => {
            const isSelected = btn.classList.toggle("selected");
            preview.style.display = isSelected ? "block" : "none";
            if (isSelected) {
                selectedCharacterIds.add(character.id);
            }
            else {
                selectedCharacterIds.delete(character.id);
            }
        });

        row.appendChild(btn);
        row.appendChild(preview);
        list.appendChild(row);
    });
}
// ----------------------------------------
// 선택된 캐릭터
// ----------------------------------------
function getSelectedCharacters() {
    return cachedCharacters.filter(
        c => selectedCharacterIds.has(c.id)
    );
}
// ----------------------------------------
// 판정
// ----------------------------------------
function rollSelected() {
    const characters = getSelectedCharacters();
    if (characters.length === 0) {
        alert("캐릭터를 선택하세요.");
        return;
    }
    const statName =
        document.getElementById("statSelect").value;
    const tbody =
        document.getElementById("resultTable");
    tbody.innerHTML = "";
    const resultLines = [];
    characters.forEach(character => {
        const result =
            DiceEngine.rollCharacter(
                character,
                statName
            );
        addResultRow(
            tbody,
            result
        );
        resultLines.push(
            `${result.name} [${result.dice}/${result.rank}]`
        );
    });
    document.getElementById("resultText").textContent =
        resultLines.join("\n");
}
// ----------------------------------------
// 결과 텍스트 복사
// ----------------------------------------
function copyResultText() {
    const text = document.getElementById("resultText").textContent;
    if (text.trim() === "") {
        alert("복사할 판정 결과가 없습니다.");
        return;
    }
    navigator.clipboard.writeText(text)
        .then(() => {
            alert("결과가 클립보드에 복사되었습니다.");
        })
        .catch(() => {
            alert("복사에 실패했습니다. 직접 드래그해서 복사해주세요.");
        });
}
// ----------------------------------------
// 결과 출력
// ----------------------------------------
function addResultRow(tbody, result) {
    const tr = document.createElement("tr");
    let className = "";
    switch (result.rank) {
        case "대성공":
            className = "critical-success";
            break;
        case "극단적 성공":
            className = "extreme-success";
            break;
        case "어려운 성공":
            className = "hard-success";
            break;
        case "성공":
            className = "success";
            break;
        case "실패":
            className = "fail";
            break;
        case "대실패":
            className = "critical-fail";
            break;
    }
    tr.innerHTML = `
        <td>
            ${result.name}
        </td>
        <td>
            ${statNames[result.statName]}
        </td>
        <td>
            ${result.target}
        </td>
        <td class="${className}">
            [${result.dice}/${result.rank}]
        </td>
    `;
    tbody.appendChild(tr);
}
