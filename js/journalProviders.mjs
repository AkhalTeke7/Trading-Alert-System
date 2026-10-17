// Journal is local-only (browser localStorage + compressed base64 export). No cloud provider.
// Kept as a registry stub so old imports don't break — all providers report "not configured".
export const providers = {
  local: {
    id: 'local',
    isConfigured: () => false,
    diagnostics: () => ({ local: true }),
    upload: async () => { throw new Error('Journal is local-only — export JSON instead'); },
    putJson: async () => { throw new Error('Journal is local-only'); },
    getJson: async () => null,
    findInfo: async () => null,
    journalName: () => 'price-alert-journal.json',
    configHelp: () => ({ hint: 'Journal is local — use Export/Import JSON in journal.html' }),
    isQuotaError: () => false,
  },
};

export function getProvider(){ return providers.local; }
export function listProviders(){ return Object.keys(providers); }
