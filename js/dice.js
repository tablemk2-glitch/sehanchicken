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
    document
        .getElementById("btnApplyAll")
        .addEventListener("click", applyStatToAllSelected);
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
        const valueText = character.specialtyValue != null ? ` ${character.specialtyValue}` : "";
        parts.push(`특기 ${character.specialty}${valueText}`);
    }
    return parts.join(" · ");
}
// ----------------------------------------
// 선택된 캐릭터 id -> 개별 스탯 매핑
// (같은 스탯을 공유하지 않고, 캐릭터마다 다른 스탯을 지정할 수 있게 Map 사용)
// ----------------------------------------
const selectedCharacterStats = new Map();
// ----------------------------------------
// 캐릭터 목록 캐시 (판정 시 다시 불러오지 않기 위함)
// ----------------------------------------
let cachedCharacters = [];
// ----------------------------------------
// 스탯 select 엘리먼트 생성 (재사용)
// ----------------------------------------
function createStatSelect(defaultValue) {
    const select = document.createElement("select");
    select.className = "character-stat-select";
    Object.entries(statNames).forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    });
    select.value = defaultValue;
    return select;
}
// ----------------------------------------
// 캐릭터 목록 출력 (버튼 방식)
// ----------------------------------------
async function loadCharacterList() {
    const list = document.getElementById("characterList");
    list.innerHTML = "<p>불러오는 중...</p>";
    selectedCharacterStats.clear();

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

        // 선택 시에만 보이는 상세 영역 (스탯 선택 + 미리보기)
        const detail = document.createElement("div");
        detail.className = "character-detail";
        detail.style.display = "none";

        const defaultStat = document.getElementById("statSelect").value;
        const statSelect = createStatSelect(defaultStat);

        const preview = document.createElement("div");
        preview.className = "character-preview";
        preview.textContent = buildCharacterPreview(character);

        detail.appendChild(statSelect);
        detail.appendChild(preview);

        btn.addEventListener("click", () => {
            const isSelected = btn.classList.toggle("selected");
            detail.style.display = isSelected ? "block" : "none";
            if (isSelected) {
                selectedCharacterStats.set(character.id, statSelect.value);
            }
            else {
                selectedCharacterStats.delete(character.id);
            }
        });

        statSelect.addEventListener("change", () => {
            if (selectedCharacterStats.has(character.id)) {
                selectedCharacterStats.set(character.id, statSelect.value);
            }
        });

        row.appendChild(btn);
        row.appendChild(detail);
        list.appendChild(row);
    });
}
// ----------------------------------------
// 전체 적용: 선택된 캐릭터 전부에게 상단 기본 스탯을 일괄 적용
// ----------------------------------------
function applyStatToAllSelected() {
    if (selectedCharacterStats.size === 0) {
        alert("선택된 캐릭터가 없습니다.");
        return;
    }
    const defaultStat = document.getElementById("statSelect").value;
    document.querySelectorAll(".character-select-item.selected")
        .forEach(btn => {
            const detail = btn.nextElementSibling;
            const select = detail.querySelector(".character-stat-select");
            select.value = defaultStat;
        });
    selectedCharacterStats.forEach((_, id) => {
        selectedCharacterStats.set(id, defaultStat);
    });
}
// ----------------------------------------
// 선택된 캐릭터 (id + 각자의 스탯)
// ----------------------------------------
function getSelectedCharacterEntries() {
    return cachedCharacters
        .filter(c => selectedCharacterStats.has(c.id))
        .map(c => ({
            character: c,
            statName: selectedCharacterStats.get(c.id)
        }));
}
// ----------------------------------------
// 판정 (캐릭터마다 다른 스탯으로 동시에 판정 가능)
// ----------------------------------------
function rollSelected() {
    const entries = getSelectedCharacterEntries();
    if (entries.length === 0) {
        alert("캐릭터를 선택하세요.");
        return;
    }
    const tbody = document.getElementById("resultTable");
    tbody.innerHTML = "";
    const resultLines = [];

    entries.forEach(({ character, statName }) => {
        const characterForRoll =
            (statName === "specialty")
                ? { ...character, stats: { ...character.stats, specialty: character.specialtyValue } }
                : character;
        const result = DiceEngine.rollCharacter(characterForRoll, statName);
        addResultRow(tbody, result);
        resultLines.push(`${result.name} [${result.dice}/${result.rank}]`);
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
