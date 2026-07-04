// ============================================
// storage.js
// Character Manager Storage Module (Firebase Firestore 버전)
// ============================================

// ⚠️ Firebase 콘솔 > 프로젝트 설정 > 일반 > 내 앱 에서 확인한 값으로 교체하세요
const firebaseConfig = {
  apiKey: "AIzaSyCweWWpQqbWRwA07-4yDSm7Oi6pawIpen8",
  authDomain: "sehanchicken-44fe0.firebaseapp.com",
  projectId: "sehanchicken-44fe0",
  storageBucket: "sehanchicken-44fe0.firebasestorage.app",
  messagingSenderId: "90969724322",
  appId: "1:90969724322:web:b435e69424669a511b8efb",
  measurementId: "G-5R0DK4Q65E"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Firestore 컬렉션 이름
const COLLECTION_NAME = "characters";

// 기본 프로필 이미지
const DEFAULT_PROFILE = "img/default-profile.png";

// ============================================
// 전체 캐릭터 반환 (비동기)
// ============================================

async function getCharacters() {

    const snapshot = await db.collection(COLLECTION_NAME)
        .orderBy("createdAt")
        .get();

    return snapshot.docs.map(doc => ({

        id: doc.id,

        ...doc.data()

    }));

}

// ============================================
// ID로 캐릭터 검색 (비동기)
// ============================================

async function getCharacter(id) {

    const doc = await db.collection(COLLECTION_NAME)
        .doc(String(id))
        .get();

    if (!doc.exists) {

        return null;

    }

    return { id: doc.id, ...doc.data() };

}

// ============================================
// 캐릭터 추가 (비동기)
// ============================================

async function addCharacter(character) {

    if (!character.profile || character.profile === "") {

        character.profile = DEFAULT_PROFILE;

    }

    character.createdAt =
        firebase.firestore.FieldValue.serverTimestamp();

    const docRef = await db.collection(COLLECTION_NAME).add(character);

    return { id: docRef.id, ...character };

}

// ============================================
// 캐릭터 수정 (비동기)
// ============================================

async function updateCharacter(id, newData) {

    if (!newData.profile || newData.profile === "") {

        newData.profile = DEFAULT_PROFILE;

    }

    delete newData.id;

    try {

        await db.collection(COLLECTION_NAME)
            .doc(String(id))
            .set(newData, { merge: true });

        return true;

    }

    catch {

        return false;

    }

}

// ============================================
// 캐릭터 삭제 (비동기)
// ============================================

async function deleteCharacter(id) {

    await db.collection(COLLECTION_NAME)
        .doc(String(id))
        .delete();

}

// ============================================
// 전체 삭제 (비동기)
// ============================================

async function clearCharacters() {

    const snapshot = await db.collection(COLLECTION_NAME).get();

    const batch = db.batch();

    snapshot.docs.forEach(doc => batch.delete(doc.ref));

    await batch.commit();

}

// ============================================
// 이름 검색 (비동기)
// ============================================

async function findCharacterByName(name) {

    const characters = await getCharacters();

    return characters.find(c => c.name === name);

}

// ============================================
// 이름 존재 여부 (비동기)
// ============================================

async function existsCharacter(name) {

    const found = await findCharacterByName(name);

    return found !== undefined;

}

// ============================================
// JSON Export (비동기)
// ============================================

async function exportCharacters() {

    const characters = await getCharacters();

    return JSON.stringify(

        characters,

        null,

        4

    );

}

// ============================================
// JSON Import (비동기)
// ============================================

async function importCharacters(jsonText) {

    try {

        const list = JSON.parse(jsonText);

        if (!Array.isArray(list)) {

            return false;

        }

        await clearCharacters();

        for (const character of list) {

            delete character.id;
            delete character.createdAt;

            await addCharacter(character);

        }

        return true;

    }

    catch {

        return false;

    }

}

// ============================================
// 샘플 캐릭터 생성 (비동기)
// ============================================

async function createSampleCharacters() {

    await clearCharacters();

    await addCharacter({

        name: "홍길동",

        profile: DEFAULT_PROFILE,

        stats: {

            strength: 3,

            agility: 4,

            intelligence: 2,

            luck: 3

        },

        specialty: "쌍검술",

        specialtyValue: 4,

        specialtyDesc: "양손에 검을 들고 연속 공격을 가하는 근접 특기",

        memo: ""

    });

    await addCharacter({

        name: "김철수",

        profile: DEFAULT_PROFILE,

        stats: {

            strength: 4,

            agility: 2,

            intelligence: 3,

            luck: 2

        },

        specialty: "해킹",

        specialtyValue: 5,

        specialtyDesc: "보안 시스템을 우회하고 전자 장비를 원격으로 제어",

        memo: ""

    });

    await addCharacter({

        name: "이영희",

        profile: DEFAULT_PROFILE,

        stats: {

            strength: 2,

            agility: 5,

            intelligence: 4,

            luck: 5

        },

        specialty: "저격",

        specialtyValue: 4,

        specialtyDesc: "장거리에서 정밀 사격으로 목표를 제압",

        memo: ""

    });

}

// ============================================
// 캐릭터 수 (비동기)
// ============================================

async function getCharacterCount() {

    const characters = await getCharacters();

    return characters.length;

}

// ============================================
// 정렬 (비동기)
// ============================================

async function sortCharactersByName() {

    const characters = await getCharacters();

    characters.sort((a, b) =>

        a.name.localeCompare(

            b.name,

            "ko"

        )

    );

    return characters;

}

console.log("Firestore Storage Ready");
