export default function register(pipeline) {
  pipeline.register({
    id: 'custom-test:always',
    kind: 'finding',
    run() {
      return [
        {
          id: 'custom-test:always',
          profileKind: 'extension',
          severity: 'info',
          category: 'custom-test',
          title: 'Custom always-on finding',
          evidence: {
            file: 'plugin-fixture',
            line: 0,
            function: 'always',
            selfPct: 0,
            extra: { source: 'plugin-fixture' },
          },
          why: 'Exercises the plugin pipeline from the CLI.',
          suggestion: 'No action required.',
          references: [],
        },
      ];
    },
  });
}
