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
        .addEventListener("click", applyStatToAllExpanded);
    document
        .getElementById("btnResetSelection")
        .addEventListener("click", resetSelection);
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
// 캐릭터의 개별 스탯 라인 데이터 생성
// (근력/민첩/지능/행운 + 있다면 특기명)
// ----------------------------------------
function buildStatLines(character) {
    const stats = character.stats;
    const lines = [
        { statKey: "strength", label: "근력", value: stats.strength },
        { statKey: "agility", label: "민첩", value: stats.agility },
        { statKey: "intelligence", label: "지능", value: stats.intelligence },
        { statKey: "luck", label: "행운", value: stats.luck }
    ];

    if (character.specialty) {
        const value =
            character.specialtyValue != null
                ? character.specialtyValue
                : stats.specialty;
        lines.push({
            statKey: "specialty",
            label: character.specialty, // 특기명을 라벨로 그대로 사용
            value
        });
    }

    return lines;
}

// ----------------------------------------
// 선택된 캐릭터 id -> 선택된 스탯 매핑
// (캐릭터마다 다른 스탯을 지정할 수 있도록 Map 사용)
// ----------------------------------------
const selectedCharacterStats = new Map();

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

        // 이름 버튼 (클릭 시 상세 정보 펼침/접힘)
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "character-select-item";
        btn.textContent = character.name;

        // 상세 영역 (스탯 라인들을 클릭해서 바로 선택)
        const detail = document.createElement("div");
        detail.className = "character-detail";
        detail.style.display = "none";

        const statLines = buildStatLines(character);

        statLines.forEach(line => {
            const statEl = document.createElement("div");
            statEl.className = "character-stat-line";
            statEl.dataset.stat = line.statKey;
            statEl.textContent = `${line.label} ${line.value}`;

            // 스탯 글씨 클릭 -> 해당 스탯을 판정용으로 즉시 선택
            statEl.addEventListener("click", () => {
                selectStatForCharacter(character.id, line.statKey, detail, btn);
            });

            detail.appendChild(statEl);
        });

        // 이름 클릭 -> 상세 정보 펼침/접힘만 담당 (선택 여부는 그대로 유지)
        btn.addEventListener("click", () => {
            const isExpanded = btn.classList.toggle("expanded");
            detail.style.display = isExpanded ? "block" : "none";
        });

        row.appendChild(btn);
        row.appendChild(detail);
        list.appendChild(row);
    });
}

// ----------------------------------------
// 캐릭터의 특정 스탯을 판정용으로 선택/해제 (토글)
// ----------------------------------------
function selectStatForCharacter(characterId, statKey, detailEl, btnEl) {
    const currentStat = selectedCharacterStats.get(characterId);

    if (currentStat === statKey) {
        // 같은 스탯을 다시 누르면 선택 해제
        selectedCharacterStats.delete(characterId);
        btnEl.classList.remove("selected");
        detailEl
            .querySelectorAll(".character-stat-line.stat-selected")
            .forEach(el => el.classList.remove("stat-selected"));
        return;
    }

    // 스탯 선택 (같은 캐릭터 내에서는 하나만 선택 가능)
    selectedCharacterStats.set(characterId, statKey);
    btnEl.classList.add("selected");

    detailEl.querySelectorAll(".character-stat-line").forEach(el => {
        el.classList.toggle("stat-selected", el.dataset.stat === statKey);
    });
}

// ----------------------------------------
// 일괄 적용: 현재 펼쳐져 있는(상세 정보가 보이는) 캐릭터 전부에게
// 상단 기본 스탯을 한 번에 적용 (개별 클릭 불필요)
// ----------------------------------------
function applyStatToAllExpanded() {
    const defaultStat = document.getElementById("statSelect").value;

    const expandedRows = document.querySelectorAll(
        ".character-select-item.expanded"
    );

    if (expandedRows.length === 0) {
        alert("먼저 캐릭터 이름을 눌러 정보를 펼쳐주세요.");
        return;
    }

    expandedRows.forEach(btn => {
        const row = btn.closest(".character-select-row");
        const detail = row.querySelector(".character-detail");
        const targetLine = detail.querySelector(
            `.character-stat-line[data-stat="${defaultStat}"]`
        );

        // 특기가 없는 캐릭터는 specialty 옵션이 존재하지 않을 수 있음
        if (!targetLine) return;

        const characterId = findCharacterIdByRow(row);
        selectedCharacterStats.set(characterId, defaultStat);
        btn.classList.add("selected");

        detail.querySelectorAll(".character-stat-line").forEach(el => {
            el.classList.toggle("stat-selected", el === targetLine);
        });
    });
}

// ----------------------------------------
// row(DOM) -> 해당 캐릭터 id 찾기 (이름 텍스트 기준 매칭)
// ----------------------------------------
function findCharacterIdByRow(row) {
    const name = row.querySelector(".character-select-item").textContent;
    const character = cachedCharacters.find(c => c.name === name);
    return character ? character.id : null;
}

// ----------------------------------------
// 선택 초기화: 선택된 캐릭터/스탯 전부 해제
// ----------------------------------------
function resetSelection() {
    selectedCharacterStats.clear();

    document.querySelectorAll(".character-select-item").forEach(btn => {
        btn.classList.remove("selected", "expanded");
    });

    document.querySelectorAll(".character-detail").forEach(detail => {
        detail.style.display = "none";
        detail
            .querySelectorAll(".character-stat-line.stat-selected")
            .forEach(el => el.classList.remove("stat-selected"));
    });

    document.getElementById("resultTable").innerHTML = "";
    document.getElementById("resultText").textContent = "";
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
            statName === "specialty"
                ? {
                      ...character,
                      stats: { ...character.stats, specialty: character.specialtyValue }
                  }
                : character;
        const result = DiceEngine.rollCharacter(characterForRoll, statName);
        addResultRow(tbody, result);
        resultLines.push(
            `${result.name} ${statNames[result.statName]} [${result.dice}/${result.rank}]`
        );
    });

    document.getElementById("resultText").textContent = resultLines.join("\n");
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
    navigator.clipboard
        .writeText(text)
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
