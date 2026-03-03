const { parseConfigString, resolveConfig } = require('../parse-config.cjs');

const SAMPLE_CFG = `
# Sample config
[common]
NODE_VERSION=20
BUILD_COMMAND=npm run build
PUBLISH_DIR=dist

[gamma]
NETLIFY_SITE_ID=gamma-id-123
DEPLOY_URL=https://gamma.example.com
LOG_LEVEL=debug

[prod]
NETLIFY_SITE_ID=prod-id-456
DEPLOY_URL=https://prod.example.com
LOG_LEVEL=warn
`;

describe('parseConfigString', () => {
  it('parses sections and key-value pairs', () => {
    const sections = parseConfigString(SAMPLE_CFG);
    expect(sections.common.NODE_VERSION).toBe('20');
    expect(sections.gamma.NETLIFY_SITE_ID).toBe('gamma-id-123');
    expect(sections.prod.DEPLOY_URL).toBe('https://prod.example.com');
  });

  it('ignores comments and blank lines', () => {
    const sections = parseConfigString(SAMPLE_CFG);
    expect(Object.keys(sections)).toEqual(['common', 'gamma', 'prod']);
  });

  it('handles values with = sign', () => {
    const sections = parseConfigString('[test]\nFOO=bar=baz\n');
    expect(sections.test.FOO).toBe('bar=baz');
  });
});

describe('resolveConfig', () => {
  const sections = parseConfigString(SAMPLE_CFG);

  it('merges common with environment', () => {
    const config = resolveConfig(sections, 'gamma');
    expect(config.NODE_VERSION).toBe('20');
    expect(config.BUILD_COMMAND).toBe('npm run build');
    expect(config.NETLIFY_SITE_ID).toBe('gamma-id-123');
    expect(config.LOG_LEVEL).toBe('debug');
  });

  it('environment overrides common', () => {
    const both = parseConfigString('[common]\nX=1\n[env]\nX=2\n');
    expect(resolveConfig(both, 'env').X).toBe('2');
  });

  it('throws for unknown environment', () => {
    expect(() => resolveConfig(sections, 'staging')).toThrow(/Unknown environment/);
  });
});
