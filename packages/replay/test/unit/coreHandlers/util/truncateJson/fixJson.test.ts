import fs from 'fs';
import path from 'path';

import { fixJson } from '../../../../../src/util/truncateJson/fixJson';

describe('Unit  | coreHandlers | util | truncateJson | fixJson', () => {
  test.each([
    // Basic steps of object completion
    ['{', '{"~~":"~~"}'],
    ['{}', '{}'],
    ['{"', '{"~~":"~~"}'],
    ['{"a', '{"a~~":"~~"}'],
    ['{"aa', '{"aa~~":"~~"}'],
    ['{"aa"', '{"aa":"~~"}'],
    ['{"aa":', '{"aa":"~~"}'],
    ['{"aa":"', '{"aa":"~~"}'],
    ['{"aa":"b', '{"aa":"b~~"}'],
    ['{"aa":"bb', '{"aa":"bb~~"}'],
    ['{"aa":"bb"', '{"aa":"bb","~~":"~~"}'],
    ['{"aa":"bb"}', '{"aa":"bb"}'],

    // Basic steps of array completion
    ['[', '["~~"]'],
    ['[]', '[]'],
    ['["', '["~~"]'],
    ['["a', '["a~~"]'],
    ['["aa', '["aa~~"]'],
    ['["aa"', '["aa","~~"]'],
    ['["aa",', '["aa","~~"]'],
    ['["aa","', '["aa","~~"]'],
    ['["aa","b', '["aa","b~~"]'],
    ['["aa","bb', '["aa","bb~~"]'],
    ['["aa","bb"', '["aa","bb","~~"]'],
    ['["aa","bb"]', '["aa","bb"]'],

    // Nested object/arrays
    ['{"a":{"bb', '{"a":{"bb~~":"~~"}}'],
    ['{"a":["bb",["cc","d', '{"a":["bb",["cc","d~~"]]}'],

    // Handles special characters in strings
    ['{"a":"hel\\"lo', '{"a":"hel\\"lo~~"}'],
    ['{"a":["this is }{some][ thing', '{"a":["this is }{some][ thing~~"]}'],
    ['{"a:a', '{"a:a~~":"~~"}'],
    ['{"a:', '{"a:~~":"~~"}'],

    // Handles incomplete non-string values
    ['{"a":true', '{"a":true,"~~":"~~"}'],
    ['{"a":false', '{"a":false,"~~":"~~"}'],
    ['{"a":null', '{"a":null,"~~":"~~"}'],
    ['{"a":tr', '{"a":"~~"}'],
    ['{"a":1', '{"a":"~~"}'],
    ['{"a":12', '{"a":"~~"}'],
    ['[12', '["~~"]'],
    ['[true', '[true,"~~"]'],
    ['{"a":1', '{"a":"~~"}'],
    ['{"a":tr', '{"a":"~~"}'],
    ['{"a":true', '{"a":true,"~~":"~~"}'],

    // Handles whitespace
    ['{"a" : true', '{"a" : true,"~~":"~~"}'],
    ['{"a" : "aa', '{"a" : "aa~~"}'],
    ['[1, 2, "a ", ', '[1, 2, "a ","~~"]'],
    ['[1, 2, true ', '[1, 2, true ,"~~"]'],
    // Complex nested JSON
    ['{"aa":{"bb":"yes","cc":true},"xx":["aa",1,true', '{"aa":{"bb":"yes","cc":true},"xx":["aa",1,true,"~~"]}'],
  ])('it works for %s', (json, expected) => {
    const actual = fixJson(json);
    expect(actual).toEqual(expected);
  });

  test.each(['1', '2'])('it works for fixture %s_incompleteJson.txt', fixture => {
    const input = fs
      .readFileSync(path.resolve(__dirname, `../../../../fixtures/fixJson/${fixture}_incompleteJson.txt`), 'utf8')
      .trim();
    const expected = fs
      .readFileSync(path.resolve(__dirname, `../../../../fixtures/fixJson/${fixture}_completeJson.json`), 'utf8')
      .trim();

    const actual = fixJson(input);
    expect(actual).toEqual(expected);
  });
});
