import { db, auth } from '../config/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  onSnapshot,
  QueryConstraint,
  addDoc,
  getDocFromServer,
} from 'firebase/firestore';
import { AuditAcao } from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Remove valores undefined recursivamente para evitar erros do SDK do Firestore
 */
function sanitizarParaFirestore<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== undefined)
      .map((item) => sanitizarParaFirestore(item)) as unknown as T;
  }
  const limpo: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value !== undefined) {
      limpo[key] = sanitizarParaFirestore(value);
    }
  }
  return limpo as T;
}

/**
 * Validação de conexão em tempo real 24h com a nuvem Firestore
 */
export async function testConnection(): Promise<boolean> {
  try {
    await getDoc(doc(db, 'test', 'connection'));
    return true;
  } catch {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Registra trilha de auditoria diretamente na nuvem Firestore 24h
 */
export async function registrarAuditoria(
  postoId: string,
  usuarioId: string,
  usuarioNome: string,
  modulo: string,
  entidade: string,
  entidadeId: string,
  acao: AuditAcao,
  dadosAnteriores?: Record<string, unknown> | null,
  dadosNovos?: Record<string, unknown> | null
) {
  const path = `postos/${postoId}/auditoria`;
  try {
    const colRef = collection(db, 'postos', postoId, 'auditoria');
    const payload = sanitizarParaFirestore({
      postoId,
      usuarioId: usuarioId || 'operador-nuvem',
      usuarioNome: usuarioNome || 'Operador',
      modulo,
      entidade,
      entidadeId: entidadeId || 'geral',
      acao,
      dadosAnteriores: dadosAnteriores || null,
      dadosNovos: dadosNovos || null,
      timestamp: new Date().toISOString(),
      dispositivo: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 100) : 'Web Cloud 24h',
    });
    await addDoc(colRef, payload);
  } catch (err) {
    console.error('Falha ao gravar auditoria na nuvem:', err);
  }
}

/**
 * Repositório Base Genérico conectado 24h em tempo real ao Google Cloud Firestore
 */
export class PostoSubcollectionRepository<T extends { id: string }> {
  constructor(private subcollectionName: string) {}

  private getCollection(postoId: string) {
    return collection(db, 'postos', postoId, this.subcollectionName);
  }

  async getById(postoId: string, id: string): Promise<T | null> {
    const path = `postos/${postoId}/${this.subcollectionName}/${id}`;
    try {
      const dRef = doc(db, 'postos', postoId, this.subcollectionName, id);
      const snap = await getDoc(dRef);
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as T;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
      return null;
    }
  }

  /** For imports: a failed read must not be mistaken for an empty collection. */
  async getAllStrict(postoId: string): Promise<T[]> {
    const snap = await getDocs(this.getCollection(postoId));
    return snap.docs.map(d => ({ ...d.data(), id: d.id } as T));
  }

  async getAll(postoId: string, ...constraints: QueryConstraint[]): Promise<T[]> {
    const path = `postos/${postoId}/${this.subcollectionName}`;
    try {
      const col = this.getCollection(postoId);
      const q = query(col, ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
      return [];
    }
  }

  async save(postoId: string, item: T): Promise<void> {
    const path = `postos/${postoId}/${this.subcollectionName}/${item.id}`;
    try {
      const dRef = doc(db, 'postos', postoId, this.subcollectionName, item.id);
      const payload = sanitizarParaFirestore({
        ...item,
        postoId,
      });
      await setDoc(dRef, payload, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }

  async saveBatch(postoId: string, items: T[]): Promise<void> {
    if (!items || items.length === 0) return;
    const path = `postos/${postoId}/${this.subcollectionName}`;
    try {
      for (let i = 0; i < items.length; i += 400) {
        const batch = writeBatch(db);
        items.slice(i, i + 400).forEach((item) => {
          const dRef = doc(db, 'postos', postoId, this.subcollectionName, item.id);
          const payload = sanitizarParaFirestore({
            ...item,
            postoId,
          });
          batch.set(dRef, payload as Record<string, unknown>, { merge: true });
        });
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }

  async deleteBatch(postoId: string, ids: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    const path = `postos/${postoId}/${this.subcollectionName}`;
    try {
      for (let i = 0; i < ids.length; i += 400) {
        const batch = writeBatch(db);
        ids.slice(i, i + 400).forEach((id) => {
          const dRef = doc(db, 'postos', postoId, this.subcollectionName, id);
          batch.delete(dRef);
        });
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  async update(postoId: string, id: string, data: Partial<T>): Promise<void> {
    const path = `postos/${postoId}/${this.subcollectionName}/${id}`;
    try {
      const dRef = doc(db, 'postos', postoId, this.subcollectionName, id);
      const payload = sanitizarParaFirestore({
        ...data,
        postoId,
      });
      await updateDoc(dRef, payload as Record<string, unknown>);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  async delete(postoId: string, id: string): Promise<void> {
    const path = `postos/${postoId}/${this.subcollectionName}/${id}`;
    try {
      const dRef = doc(db, 'postos', postoId, this.subcollectionName, id);
      await deleteDoc(dRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  async clearAll(postoId: string): Promise<void> {
    const path = `postos/${postoId}/${this.subcollectionName}`;
    try {
      const col = this.getCollection(postoId);
      const snap = await getDocs(col);
      if (snap.empty) return;
      // Firestore batch suporta até 500 operações por lote
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach((d) => {
          batch.delete(d.ref);
        });
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  subscribe(postoId: string, onUpdate: (items: T[]) => void, ...constraints: QueryConstraint[]) {
    const path = `postos/${postoId}/${this.subcollectionName}`;
    const col = this.getCollection(postoId);
    const q = query(col, ...constraints);
    return onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));
        onUpdate(items);
      },
      (err) => {
        console.warn(`Erro no listener em nuvem da coleção ${this.subcollectionName}:`, err);
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );
  }
}
