// Direcao: identity <- data-sources <- queries <- dashboards <- ai
const allowed = {
  identity: [],
  'data-sources': ['identity'],
  queries: ['identity', 'data-sources'],
  dashboards: ['identity', 'data-sources', 'queries'],
  ai: ['identity', 'data-sources', 'queries', 'dashboards'],
};
const mods = Object.keys(allowed);
const exposed = '(api|model|hooks|components|pages)';

module.exports = {
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.tsx?$' },
    tsConfig: { fileName: 'tsconfig.app.json' },
  },
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    ...mods.map((m) => ({
      name: `modulo-${m}-direcao`,
      severity: 'error',
      comment: `${m} so importa de: ${allowed[m].join(', ') || '(nenhum)'}`,
      from: { path: `^src/modules/${m}/` },
      to: {
        path: `^src/modules/(${mods.filter((x) => x !== m && !allowed[m].includes(x)).join('|')})/`,
      },
    })),
    {
      name: 'modulo-so-exposto',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/([^/]+)/', pathNot: ['^src/modules/$1/', `^src/modules/[^/]+/${exposed}(/|\\.)`] },
    },
    { name: 'shared-nao-importa-modules-app', severity: 'error', from: { path: '^src/shared/' }, to: { path: '^src/(modules|app)/' } },
    { name: 'modules-nao-importam-app', severity: 'error', from: { path: '^src/modules/' }, to: { path: '^src/app/' } },
  ],
};
