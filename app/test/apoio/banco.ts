import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { criarDb, type Db } from '../../src/db.js';
import { migrar } from '../../src/migrate.js';

// Tabelas semeadas pelas migrações (ou de controle delas): nunca são limpas.
const PRESERVADAS = ['segmentos', 'empresas', 'negocios', 'categorias', 'bases_conhecimento', 'schema_migrations'];

function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function lerPidDoPostmaster(dir: string): number | null {
  const arquivo = path.join(dir, 'postmaster.pid');
  if (!existsSync(arquivo)) return null;
  const pid = Number.parseInt(readFileSync(arquivo, 'utf8').split('\n')[0] ?? '', 10);
  return Number.isInteger(pid) ? pid : null;
}

// No Windows os processos-filho do servidor embutido podem sobreviver ao desligamento.
// Encerra a árvore do postmaster e qualquer postgres.exe vindo do node_modules deste projeto
// (nunca toca em outro Postgres instalado na máquina). A linha de comando usa barras normais.
function encerrarPostgresDoProjeto(pid: number | null) {
  if (process.platform !== 'win32') {
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // já encerrado
      }
    }
    return;
  }
  if (pid) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // já encerrado
    }
  }
  const raiz = path.resolve(process.cwd(), 'node_modules', '@embedded-postgres').replaceAll('\\', '/').replaceAll("'", "''");
  const script =
    `Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${raiz}*' } | ` +
    `ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
  } catch {
    // nada a encerrar
  }
}

/** Sobe um Postgres real e descartável (dados em tmpdir), cria o banco `ana` e aplica as migrações. */
export async function iniciarBanco(): Promise<{ db: Db; parar(): Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ana-pg-'));
  const porta = await portaLivre();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port: porta,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('ana');
  const db = criarDb(`postgres://postgres:postgres@127.0.0.1:${porta}/ana`);
  await migrar(db);
  return {
    db,
    async parar() {
      const pid = lerPidDoPostmaster(dir);
      try {
        await db.end();
      } catch {
        // pool já encerrado
      }
      try {
        await pg.stop();
      } catch {
        // no Windows a limpeza do diretório pelo próprio pacote pode dar EBUSY; o servidor já parou
      } finally {
        encerrarPostgresDoProjeto(pid);
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch {
          // diretório descartável em tmpdir
        }
      }
    },
  };
}

/** Esvazia as tabelas de dados (reiniciando as sequências), preservando o cadastro semeado pelas migrações. */
export async function limparBanco(db: Db): Promise<void> {
  const { rows } = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> ALL($1::text[])`,
    [PRESERVADAS],
  );
  if (rows.length === 0) return;
  const lista = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.query(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`);
}
