const C=require('./ContractError');
test('default',()=>{const e=new C('m');expect(e.status).toBe(400});
test('throw',()=>{expect(()=>{throw new C('x')}).toThrow(C)});
test('no new',()=>{expect(()=>C('x')).toThrow(TypeError)});
