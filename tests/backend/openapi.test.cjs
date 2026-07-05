// Validates public/openapi.yaml (the doc model for the Trading DB API) and
// keeps it honest against the implemented endpoints.

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const SwaggerParser = require('@apidevtools/swagger-parser');

const SPEC_PATH = path.join(__dirname, '../../public/openapi.yaml');

describe('openapi.yaml', () => {
  let spec;

  beforeAll(() => {
    spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
  });

  test('is a valid OpenAPI 3 document (full validation incl. $refs)', async () => {
    // validate() dereferences and checks the whole document; throws on any error
    await SwaggerParser.validate(SPEC_PATH);
  });

  test('documents exactly the implemented endpoints and methods', () => {
    expect(Object.keys(spec.paths).sort()).toEqual(['/db-bot-activity', '/db-orders', '/db-pnl']);
    expect(Object.keys(spec.paths['/db-orders']).sort()).toEqual(['delete', 'get', 'post']);
    expect(Object.keys(spec.paths['/db-bot-activity']).sort()).toEqual(['get', 'post']);
    expect(Object.keys(spec.paths['/db-pnl'])).toEqual(['get']);
  });

  test('envelope schema matches the shared envelope contract', () => {
    const envelope = spec.components.schemas.Envelope;
    expect(envelope.required.sort()).toEqual(['action', 'as_of', 'data', 'error', 'ok', 'resource', 'source']);
    expect(envelope.properties.source.enum).toEqual(['netlify-db', 'memory']);
  });

  test('error codes stay in sync with lib/tradingDb error responses', () => {
    const codes = spec.components.schemas.ApiError.properties.code.enum;
    for (const code of ['DB_NOT_CONFIGURED', 'UNAUTHORIZED', 'BAD_JSON', 'NO_ORDERS', 'NO_EVENTS', 'MISSING_PARAM', 'BAD_PERIOD', 'METHOD_NOT_ALLOWED', 'DB_ERROR']) {
      expect(codes).toContain(code);
    }
  });

  test('production server URL points at the functions base', () => {
    expect(spec.servers[0].url).toBe('https://5thstreetcapital.netlify.app/.netlify/functions');
  });
});
