import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function createTestDB() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_security.sql',import.meta.url),'utf8'));
  return {
    sqlite,
    prepare(sql) {
      let parameters = [];
      return {
        bind(...values) { parameters = values; return this; },
        async first() { return sqlite.prepare(sql).get(...parameters) || null; },
        async run() { return { meta:sqlite.prepare(sql).run(...parameters) }; }
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
}
export function testEnv() {
  return {
    DB:createTestDB(), PUBLIC_ORIGIN:'https://timesaver.test', LEGAL_READY:'true', MAIL_ENABLED:'true',
    HSTS_ENABLED:'false', RESEND_API_KEY:'re_only_a_unit_test_value',
    SECURITY_HMAC_KEY:'unit-test-value-never-use-in-production-'.repeat(3),
    MAIL_FROM:'Time Saver <pedidos@timesaver.test>',MAIL_TO:'destino@timesaver.test'
  };
}
export function quoteData() {
  return { name:'Ana Silva',email:'ana@empresa.test',description:'Precisamos de reunir ficheiros Excel e preparar um relatório mensal.',
    company:'Loja de teste',service:'Excel',tools:'Excel e Outlook',deadline:'A definir',budget:'A definir',website:'' };
}
