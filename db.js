/**
 * Camada de Banco de Dados de Saída (IndexedDB com fallback para localStorage).
 * Armazena alunos (students) e registros de empréstimo (loans).
 */
const DB_NAME = 'LabMakerSaidaDB';
const DB_VERSION = 1;
const STORE_STUDENTS = 'students';
const STORE_LOANS = 'loans';
const FALLBACK_KEY = 'lbmk_saida_db_fallback_v1';

const SaidaDB = (() => {
  let dbInstance = null;
  let useFallback = false;

  function loadFallback() {
    try {
      const raw = localStorage.getItem(FALLBACK_KEY);
      return raw ? JSON.parse(raw) : { students: {}, loans: [], seq: 1 };
    } catch {
      return { students: {}, loans: [], seq: 1 };
    }
  }

  function saveFallback(data) {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(data));
  }

  function init() {
    if (dbInstance) return Promise.resolve(dbInstance);
    if (!('indexedDB' in window)) {
      useFallback = true;
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_STUDENTS)) {
            db.createObjectStore(STORE_STUDENTS, { keyPath: 'matricula' });
          }
          if (!db.objectStoreNames.contains(STORE_LOANS)) {
            const loanStore = db.createObjectStore(STORE_LOANS, {
              keyPath: 'id',
              autoIncrement: true,
            });
            loanStore.createIndex('status', 'status', { unique: false });
            loanStore.createIndex('matricula', 'matricula', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          dbInstance = event.target.result;
          resolve(dbInstance);
        };

        request.onerror = () => {
          useFallback = true;
          resolve(null);
        };
      } catch {
        useFallback = true;
        resolve(null);
      }
    });
  }

  async function saveStudent({ matricula, nome }) {
    const cleanMatricula = matricula.trim().toUpperCase();
    const cleanNome = nome.trim();
    const record = {
      matricula: cleanMatricula,
      nome: cleanNome,
      ultimoAcesso: new Date().toISOString(),
    };

    const db = await init();
    if (useFallback || !db) {
      const data = loadFallback();
      data.students[cleanMatricula] = record;
      saveFallback(data);
      return record;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_STUDENTS, 'readwrite');
      const store = tx.objectStore(STORE_STUDENTS);
      store.put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getStudent(matricula) {
    const cleanMatricula = matricula.trim().toUpperCase();
    const db = await init();

    if (useFallback || !db) {
      const data = loadFallback();
      return data.students[cleanMatricula] || null;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_STUDENTS, 'readonly');
      const req = tx.objectStore(STORE_STUDENTS).get(cleanMatricula);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function addLoan({ matricula, nome, material, quantidade, observacao, assinatura }) {
    const record = {
      matricula: matricula.trim().toUpperCase(),
      nome: nome.trim(),
      material: material.trim(),
      quantidade: Number(quantidade) || 1,
      observacao: (observacao || '').trim(),
      assinatura,
      status: 'pendente',
      dataSaida: new Date().toISOString(),
      dataDevolucao: null,
    };

    const db = await init();
    if (useFallback || !db) {
      const data = loadFallback();
      record.id = data.seq++;
      data.loans.push(record);
      saveFallback(data);
      return record;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_LOANS, 'readwrite');
      const store = tx.objectStore(STORE_LOANS);
      const req = store.add(record);
      req.onsuccess = () => {
        record.id = req.result;
        resolve(record);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllLoans() {
    const db = await init();
    if (useFallback || !db) {
      const data = loadFallback();
      return [...data.loans].sort((a, b) => new Date(b.dataSaida) - new Date(a.dataSaida));
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_LOANS, 'readonly');
      const req = tx.objectStore(STORE_LOANS).getAll();
      req.onsuccess = () => {
        const list = (req.result || []).sort(
          (a, b) => new Date(b.dataSaida) - new Date(a.dataSaida)
        );
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getPendingLoans() {
    const all = await getAllLoans();
    return all.filter((item) => item.status === 'pendente');
  }

  async function returnLoan(id) {
    const numericId = Number(id);
    const nowIso = new Date().toISOString();
    const db = await init();

    if (useFallback || !db) {
      const data = loadFallback();
      const idx = data.loans.findIndex((item) => item.id === numericId);
      if (idx === -1) throw new Error('Registro não encontrado.');
      data.loans[idx].status = 'devolvido';
      data.loans[idx].dataDevolucao = nowIso;
      saveFallback(data);
      return data.loans[idx];
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_LOANS, 'readwrite');
      const store = tx.objectStore(STORE_LOANS);
      const getReq = store.get(numericId);

      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) {
          reject(new Error('Registro não encontrado.'));
          return;
        }
        record.status = 'devolvido';
        record.dataDevolucao = nowIso;
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve(record);
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
    });
  }

  return {
    init,
    saveStudent,
    getStudent,
    addLoan,
    getAllLoans,
    getPendingLoans,
    returnLoan,
  };
})();
