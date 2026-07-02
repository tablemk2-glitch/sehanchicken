// ============================================
// status.js (Firebase Firestore 버전)
// ============================================
let editingId = null;
// ------------------------------
// 페이지 로드
// ------------------------------
document.addEventListener("DOMContentLoaded", () => {
    renderTable();
    document.getElementById("btnSave")
        .addEventListener("click", saveCharacter);
    document.getElementById("btnReset")
        .addEventListener("click", resetForm);
});
// ------------------------------
// 테이블 출력
// ------------------------------
async function renderTable() {
    const tbody = document.getElementById("characterTableBody");
    tbody.innerHTML = "<tr><td colspan='10'>불러오는 중...</td></tr>";

    const characters = await getCharacters();

    tbody.innerHTML = "";

    characters.forEach((character, index) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${character.name}</td>
            <td>${character.stats.strength}</td>
            <td>${character.stats.agility}</td>
            <td>${character.stats.intelligence}</td>
            <td>${character.stats.luck}</td>
            <td>${character.specialtyValue ?? ""}</td>
            <td>${character.specialty || ""}</td>
            <td>${character.memo || ""}</td>
            <td>
                <button onclick="editCharacter('${character.id}')">
                    수정
                </button>
                <button onclick="removeCharacter('${character.id}')">
                    삭제
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}
// ------------------------------
// 스탯 값 보정 (1~5 범위)
// ------------------------------
function clampStat(value) {
    const num = Number(value);
    if (isNaN(num)) return 3;
    return Math.min(5, Math.max(1, num));
}
// ------------------------------
// 저장
// ------------------------------
async function saveCharacter() {
    const name = document.getElementById("name").value.trim();
    if (name === "") {
        alert("이름을 입력하세요.");
        return;
    }
    const character = {
        name: name,
        profile: "",
        specialtyValue: clampStat(document.getElementById("specialtyValue").value),
        specialty: document.getElementById("specialty").value.trim(),
        memo: document.getElementById("memo").value.trim(),
        stats: {
            strength: clampStat(document.getElementById("strength").value),
            agility: clampStat(document.getElementById("agility").value),
            intelligence: clampStat(document.getElementById("intelligence").value),
            luck: clampStat(document.getElementById("luck").value)
        }
    };

    const btnSave = document.getElementById("btnSave");
    btnSave.disabled = true;

    try {
        if (editingId === null) {
            await addCharacter(character);
        }
        else {
            await updateCharacter(editingId, character);
        }
        resetForm();
        await renderTable();
    }
    catch (error) {
        alert("저장 중 오류가 발생했습니다.");
        console.error(error);
    }
    finally {
        btnSave.disabled = false;
    }
}
// ------------------------------
// 수정
// ------------------------------
async function editCharacter(id) {
    const character = await getCharacter(id);
    if (!character) return;
    editingId = id;
    document.getElementById("name").value = character.name;
    document.getElementById("strength").value =
        character.stats.strength;
    document.getElementById("agility").value =
        character.stats.agility;
    document.getElementById("intelligence").value =
        character.stats.intelligence;
    document.getElementById("luck").value =
        character.stats.luck;
    document.getElementById("specialtyValue").value =
        character.specialtyValue ?? 3;
    document.getElementById("specialty").value =
        character.specialty || "";
    document.getElementById("memo").value =
        character.memo || "";
    document.getElementById("btnSave").textContent =
        "수정 완료";
}
// ------------------------------
// 삭제
// ------------------------------
async function removeCharacter(id) {
    if (!confirm("삭제하시겠습니까?")) {
        return;
    }
    await deleteCharacter(id);
    if (editingId === id) {
        resetForm();
    }
    await renderTable();
}
// ------------------------------
// 입력 초기화
// ------------------------------
function resetForm() {
    editingId = null;
    document.getElementById("name").value = "";
    document.getElementById("strength").value = 3;
    document.getElementById("agility").value = 3;
    document.getElementById("intelligence").value = 3;
    document.getElementById("luck").value = 3;
    document.getElementById("specialtyValue").value = 3;
    document.getElementById("specialty").value = "";
    document.getElementById("memo").value = "";
    document.getElementById("btnSave").textContent =
        "저장";
}
