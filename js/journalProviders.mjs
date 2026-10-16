// Provider registry — Drive is the only provider today. Add more by adding an entry here.
// Each provider: { id, isConfigured(env), upload({buffer,filename,mimeType}, env), putJson(jsonString, env), getJson(env), findInfo(env), thumbProxy(id, env) }
// env = Cloudflare env binding OR null (Node will read process.env). buffer = Uint8Array/Buffer.
import * as drive from './drive.mjs';

export const providers = {
  drive: {
    id: 'drive',
    isConfigured: (env) => drive.isDriveConfigured(env),
    diagnostics: (env) => drive.getDriveDiagnostics(env),
    upload: (args, env) => drive.uploadToDrive(args, env),
    putJson: (jsonString, env) => drive.upsertJournalJson(jsonString, env),
    getJson: (env) => drive.getJournalJson(env),
    findInfo: (env) => drive.journalFileInfo(env),
    journalName: (env) => drive.getJournalName(env),
    configHelp: () => drive.getDriveConfigHelp(),
    isQuotaError: (msg) => drive.isQuotaError(msg),
  },
};

export function getProvider(id, env){
  const pid = (id || (env?.JOURNAL_PROVIDER || process.env.JOURNAL_PROVIDER) || 'drive').toLowerCase();
  return providers[pid] || providers.drive;
}
export function listProviders(){ return Object.keys(providers); }
