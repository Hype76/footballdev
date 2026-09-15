// Keep visual browser tests independent of native storage and live accounts.
export function partnerBrowserFixture() {
  return {
    name: 'partner-browser-fixture',
    setup(builder) {
      builder.onResolve({ filter: /(?:^expo-crypto$|\/supabase$)/ }, (args) => {
        if (!args.importer.replaceAll('\\', '/').endsWith('/mobile-core/src/PartnersScreen.js')) return
        return { path: args.path === 'expo-crypto' ? 'crypto' : 'supabase', namespace: 'partner-fixture' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'partner-fixture' }, (args) => ({
        contents: args.path === 'crypto'
          ? 'export const randomUUID = () => globalThis.crypto.randomUUID()'
          : `export const supabase = { async rpc(name, params) {
              if (!['parent', 'coach'].includes(params.p_app)) throw new Error('Missing partner audience')
              return { data: name === 'partner_feed' ? (window.partnerFeed || { items: [], linkedAnalytics: false }) : true, error: null }
            } }`,
        loader: 'js',
      }))
    },
  }
}
