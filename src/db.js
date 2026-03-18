const DB_NAME = "spanish-quiz";
const DB_VERSION = 3;
const STORE = "attempts";
const QUIZ_STORE = "quizzes";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const oldVersion = e.oldVersion;

      // Attempts store (unchanged structure)
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("timestamp", "timestamp");
        store.createIndex("quizKey", "quizKey");
      }

      // Quizzes store: v2 used quizKey as keyPath, v3 uses autoIncrement id
      if (oldVersion < 3 && db.objectStoreNames.contains(QUIZ_STORE)) {
        db.deleteObjectStore(QUIZ_STORE);
      }
      if (!db.objectStoreNames.contains(QUIZ_STORE)) {
        const qs = db.createObjectStore(QUIZ_STORE, { keyPath: "id", autoIncrement: true });
        qs.createIndex("quizKey", "quizKey", { unique: true });
        qs.createIndex("savedAt", "savedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      fn(store, resolve, reject);
      t.onerror = () => reject(t.error);
    });
  });
}

// ── Attempts ──

export function saveAttempt(record) {
  return tx(STORE, "readwrite", (store, resolve) => {
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
  }).catch((err) => {
    console.warn("Failed to save attempt:", err);
    return null;
  });
}

export function getAttempts(limit = 50) {
  return tx(STORE, "readonly", (store, resolve) => {
    const idx = store.index("timestamp");
    const req = idx.openCursor(null, "prev");
    const results = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && results.length < limit) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
  }).catch((err) => {
    console.warn("Failed to get attempts:", err);
    return [];
  });
}

export function deleteAttempt(id) {
  return tx(STORE, "readwrite", (store, resolve) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
  }).catch((err) => {
    console.warn("Failed to delete attempt:", err);
  });
}

export function clearAllAttempts() {
  return tx(STORE, "readwrite", (store, resolve) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
  }).catch((err) => {
    console.warn("Failed to clear attempts:", err);
  });
}

// ── Quizzes ──

export function saveQuiz(quizKey, data) {
  return tx(QUIZ_STORE, "readwrite", (store, resolve) => {
    // Check if quizKey already exists — update it, otherwise insert
    const idx = store.index("quizKey");
    const lookup = idx.get(quizKey);
    lookup.onsuccess = () => {
      if (lookup.result) {
        // Update existing record, preserving its id
        const updated = { ...lookup.result, data, savedAt: Date.now() };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated.id);
      } else {
        const addReq = store.add({ quizKey, data, savedAt: Date.now() });
        addReq.onsuccess = () => resolve(addReq.result);
      }
    };
  }).catch((err) => {
    console.warn("Failed to save quiz:", err);
    return null;
  });
}

export function getQuizzes() {
  return tx(QUIZ_STORE, "readonly", (store, resolve) => {
    const idx = store.index("savedAt");
    const req = idx.openCursor(null, "prev");
    const results = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
  }).catch((err) => {
    console.warn("Failed to get quizzes:", err);
    return [];
  });
}

export function getQuizById(id) {
  return tx(QUIZ_STORE, "readonly", (store, resolve) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
  }).catch((err) => {
    console.warn("Failed to get quiz:", err);
    return null;
  });
}

export function deleteQuiz(id) {
  return tx(QUIZ_STORE, "readwrite", (store, resolve) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
  }).catch((err) => {
    console.warn("Failed to delete quiz:", err);
  });
}
