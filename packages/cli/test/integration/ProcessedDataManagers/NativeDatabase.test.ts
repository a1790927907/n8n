import { ICheckProcessedContextData, ICheckProcessedOutput, ProcessedDataManager } from 'n8n-core';
import { INode, Workflow } from 'n8n-workflow';

import * as Helpers from '../../unit/Helpers';
import * as utils from '../shared/utils';
import * as testDb from '../shared/testDb';

import { getProcessedDataManagers } from '../../../src/ProcessedDataManagers';

let node: INode;
let testDbName: string;
let workflow: Workflow;

jest.mock('../../../src/telemetry');

beforeAll(async () => {
	const initResult = await testDb.init();
	testDbName = initResult.testDbName;

	node = {
		parameters: {},
		name: 'test',
		type: 'test.set',
		typeVersion: 1,
		position: [0, 0],
	};

	const nodeTypes = Helpers.NodeTypes();

	workflow = new Workflow({
		id: '1',
		nodes: [node],
		connections: {},
		active: false,
		nodeTypes,
	});

	utils.initTestLogger();
	utils.initTestTelemetry();

	const processedDataConfig = {
		availableModes: 'nativeDatabase',
		mode: 'nativeDatabase',
	};
	const processedDataManagers = await getProcessedDataManagers(processedDataConfig);
	await ProcessedDataManager.init(processedDataConfig, processedDataManagers);
});

beforeEach(async () => {
	await testDb.truncate(['ProcessedData'], testDbName);
});

afterAll(async () => {
	await testDb.terminate(testDbName);
});

test('ProcessedData: NativeDatabase should record and check data correctly', async () => {
	const context = 'node';
	const contextData: ICheckProcessedContextData = {
		workflow,
		node,
	};

	let processedData: ICheckProcessedOutput;
	// let response = await ProcessedDataManager.getInstance().checkProcessed(

	// processedData = await ProcessedDataManager.getInstance().checkProcessedAndRecord(
	processedData = await ProcessedDataManager.getInstance().checkProcessed(
		['a', 'b'],
		context,
		contextData,
	);

	// No data exists yet so has to be new
	expect(processedData).toEqual({ new: ['a', 'b'], processed: [] });

	processedData = await ProcessedDataManager.getInstance().checkProcessedAndRecord(
		['a', 'b'],
		context,
		contextData,
	);

	// 'a' & 'b' got only checked before, so still has to be new
	expect(processedData).toEqual({ new: ['a', 'b'], processed: [] });

	processedData = await ProcessedDataManager.getInstance().checkProcessed(
		['a', 'b', 'c'],
		context,
		contextData,
	);

	// 'a' & 'b' got recorded before, 'c' never
	expect(processedData).toEqual({ new: ['c'], processed: ['a', 'b'] });

	processedData = await ProcessedDataManager.getInstance().checkProcessedAndRecord(
		['a', 'b', 'c', 'd'],
		context,
		contextData,
	);

	// 'a' & 'b' got recorded before, 'c' only checked bfeore and 'd' has never been seen
	expect(processedData).toEqual({ new: ['c', 'd'], processed: ['a', 'b'] });

	await ProcessedDataManager.getInstance().removeProcessed(['b', 'd'], context, contextData);

	processedData = await ProcessedDataManager.getInstance().checkProcessed(
		['a', 'b', 'c', 'd'],
		context,
		contextData,
	);

	// 'b' & 'd' got removed from the database so they should be new, 'a' & 'b' should still be known
	expect(processedData).toEqual({ new: ['b', 'd'], processed: ['a', 'c'] });
});