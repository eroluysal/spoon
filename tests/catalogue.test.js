import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, api, json } from './helpers.js';

test('the catalogue paginates and orders', async () => {
  const app = await createApp();

  const firstPage = json(await api(app, { method: 'GET', url: '/catalogue?perPage=5&page=1' }));
  const secondPage = json(await api(app, { method: 'GET', url: '/catalogue?perPage=5&page=2' }));

  assert.equal(firstPage.length, 5);
  assert.equal(secondPage.length, 5);
  assert.notEqual(firstPage[0].name, secondPage[0].name);

  const descending = json(
    await api(app, { method: 'GET', url: '/catalogue?perPage=3&orderBy=price&direction=desc' }),
  );
  assert.ok(descending[0].price >= descending[1].price);
});

test('the catalogue filters by country, region, group and description', async () => {
  const app = await createApp();

  const gb = json(await api(app, { method: 'GET', url: '/catalogue?countries=GB&perPage=100' }));
  assert.ok(gb.length > 0);
  assert.ok(gb.every((bundle) => bundle.countries.some((c) => c.iso === 'GB')));

  const unlimited = json(
    await api(app, {
      method: 'GET',
      url: `/catalogue?group=${encodeURIComponent('Standard Unlimited Bundles')}&perPage=20`,
    }),
  );
  assert.ok(unlimited.every((bundle) => bundle.unlimited));

  const asia = json(await api(app, { method: 'GET', url: '/catalogue?region=Asia&perPage=20' }));
  assert.ok(asia.every((bundle) => bundle.countries.some((c) => c.region === 'Asia')));

  const described = json(
    await api(app, { method: 'GET', url: '/catalogue?description=7%20Days&perPage=20' }),
  );
  assert.ok(described.every((bundle) => bundle.description.includes('7 Days')));
});

test('a catalogue bundle carries coverage, allowances and v2.5 network data', async () => {
  const app = await createApp();
  const bundle = json(await api(app, { method: 'GET', url: '/catalogue/bundle/esim_1GB_7D_GB_V2' }));

  assert.equal(bundle.name, 'esim_1GB_7D_GB_V2');
  assert.equal(bundle.dataAmount, 1000, 'data amount is reported in MB');
  assert.equal(bundle.duration, 7);
  assert.equal(bundle.billingType, 'FixedCost');
  assert.deepEqual(bundle.countries, [{ name: 'United Kingdom', region: 'Europe', iso: 'GB' }]);
  assert.deepEqual(bundle.group, ['Standard Fixed Bundles']);

  const [dataAllowance] = bundle.allowances;
  assert.equal(dataAllowance.type, 'DATA');
  assert.equal(dataAllowance.unit, 'MB');

  const [coverage] = bundle.countryNetworks;
  assert.equal(coverage.country.iso, 'GB');
  assert.ok(coverage.networks.some((network) => network.tadig === 'GBREE'));
  assert.deepEqual(coverage.potentialNetworks, []);
});

test('bundle names are case sensitive', async () => {
  const app = await createApp();
  const response = await api(app, { method: 'GET', url: '/catalogue/bundle/ESIM_1GB_7D_GB_V2' });

  assert.equal(response.statusCode, 400);
  assert.match(json(response).message, /does not exist/);
});

test('invalid ordering and paging parameters are rejected', async () => {
  const app = await createApp();

  assert.equal((await api(app, { method: 'GET', url: '/catalogue?orderBy=nope' })).statusCode, 400);
  assert.equal((await api(app, { method: 'GET', url: '/catalogue?direction=sideways' })).statusCode, 400);
  assert.equal((await api(app, { method: 'GET', url: '/catalogue?page=0' })).statusCode, 400);
});

test('consumption prices are grouped per country and stable', async () => {
  const app = await createApp();
  const first = json(await api(app, { method: 'GET', url: '/catalogue/prices' }));
  const second = json(await api(app, { method: 'GET', url: '/catalogue/prices' }));

  assert.equal(first.hash, second.hash, 'the hash only moves when prices move');
  assert.ok(first.prices.length > 50);
  const [entry] = first.prices;
  assert.ok(entry.country.iso);
  assert.equal(entry.prices.length, 5, 'one price per network profile');
  assert.match(entry.prices[0].price, /^\d+\.\d{2}$/);
});

test('bundle groups list what the organisation can order', async () => {
  const app = await createApp();
  const { groups } = json(await api(app, { method: 'GET', url: '/organisation/groups' }));

  assert.ok(groups.some((group) => group.name === 'Standard Fixed Bundles'));
  assert.ok(groups.every((group) => group.priceListUrl.startsWith('https://')));
});

test('networks can be filtered by ISO or by country name', async () => {
  const app = await createApp();

  const byIso = json(await api(app, { method: 'GET', url: '/networks?isos=GB,TR' }));
  assert.equal(byIso.countryNetworks.length, 2);

  const uk = byIso.countryNetworks.find((entry) => entry.name === 'United Kingdom');
  assert.ok(uk);
  const ee = uk.networks.find((network) => network.name === 'EE');
  assert.equal(ee.mcc, '234');
  assert.equal(ee.mnc, '30');
  assert.equal(ee.tagid, 'GBREE');
  assert.ok(ee.speed.includes('5G'));

  const byName = json(
    await api(app, { method: 'GET', url: '/networks?countries=Japan' }),
  );
  assert.equal(byName.countryNetworks.length, 1);
  assert.equal(byName.countryNetworks[0].name, 'Japan');

  const all = json(await api(app, { method: 'GET', url: '/networks?returnAll=true' }));
  assert.ok(all.countryNetworks.length > 50);
});
