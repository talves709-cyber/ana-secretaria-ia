import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';
import { criarDb } from '../../src/db.js';
import { migrar } from '../../src/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    pgPorta: number;
  }
}

export const BANCO_MODELO = 'ana_modelo';

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
// Encerra a árvore do postmaster e qualquer postgres.exe cuja linha de comando cite o diretório de
// dados DESTA instância (nome único gerado por mkdtemp): nunca toca em outro Postgres nem em outra execução.
function encerrarArvore(pid: number | null, dir: string) {
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
  const nome = path.basename(dir).replaceAll("'", "''");
  const script =
    `Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${nome}*' } | ` +
    `ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
  } catch {
    // nada a encerrar
  }
}

/** Sobe UM Postgres embutido por execução do vitest, com o banco modelo já migrado. */
export default async function setup(project: TestProject) {
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
  await pg.createDatabase(BANCO_MODELO);
  const modelo = criarDb(`postgres://postgres:postgres@127.0.0.1:${porta}/${BANCO_MODELO}`);
  try {
    await migrar(modelo);
  } finally {
    // CREATE DATABASE ... TEMPLATE exige que ninguém esteja conectado ao modelo
    await modelo.end();
  }
  project.provide('pgPorta', porta);

  return async function encerrar() {
    const pid = lerPidDoPostmaster(dir);
    try {
      await pg.stop();
    } catch {
      // no Windows a limpeza do diretório pelo próprio pacote pode dar EBUSY; o servidor já parou
    } finally {
      encerrarArvore(pid, dir);
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // diretório descartável em tmpdir
      }
    }
  };
}
