// Local PostgreSQL adapter for exercising the real repository's query contract.
// Identifier validation is deliberately strict; this never connects remotely.
const identifier=value=>{value=value.trim();if(!/^[a-z_][a-z0-9_]*$/i.test(value))throw Error('Invalid test identifier');return `"${value}"`}
export function reminderPostgrest(db){
  return {async rpc(name,args={}){
    try{
      const values=Object.values(args).map(value=>value && typeof value==='object'&&!Array.isArray(value)?JSON.stringify(value):value)
      const parameters=Object.keys(args).map((key,index)=>`${identifier(key)}=>$${index+1}`).join(',')
      const tableResult=name==='event_player_eligible_recipients'
      const result=await db.query(tableResult?`select * from public.${identifier(name)}(${parameters})`:`select public.${identifier(name)}(${parameters}) value`,values)
      return {data:tableResult?result.rows:result.rows[0]?.value,error:null}
    }catch(error){return {data:null,error}}
  },from(table){
    let action='select',fields='*',rows,filters=[],params=[],single=false,sort='',limit='',options={}
    const add=(key,operator,value)=>{
      if(key.includes('->>')){const [column,property]=key.split('->>');if(!/^[a-zA-Z]+$/.test(property))throw Error('Invalid property');key=`${identifier(column)}->>'${property}'`}
      else key=identifier(key)
      if(operator==='is'){filters.push(`${key} is null`);return}
      params.push(value);filters.push(`${key} ${operator} $${params.length}`)
    }
    const query={select(value='*'){fields=value;return this},eq(k,v){add(k,'=',v);return this},neq(k,v){add(k,'<>',v);return this},lte(k,v){add(k,'<=',v);return this},is(k){add(k,'is');return this},
      in(k,v){params.push(v);filters.push(`${identifier(k)}=any($${params.length})`);return this},order(k){sort=` order by ${identifier(k)}`;return this},limit(n){limit=` limit ${Number(n)}`;return this},maybeSingle(){single=true;return this},single(){single=true;return this},
      upsert(value,opts={}){action='upsert';rows=Array.isArray(value)?value:[value];options=opts;return this},update(value){action='update';rows=[value];return this},
      async then(resolve,reject){try{
        let result=[]
        if(action==='select')result=(await db.query(`select ${fields==='*'?'*':fields.split(',').map(identifier).join(',')} from ${identifier(table)}${filters.length?' where '+filters.join(' and '):''}${sort}${limit}`,params)).rows
        else if(action==='upsert')for(const row of rows){
          const keys=Object.keys(row),values=Object.values(row).map(value=>value && typeof value==='object'?JSON.stringify(value):value)
          const conflict=options.onConflict?` on conflict(${options.onConflict.split(',').map(identifier).join(',')}) do nothing`:''
          result.push(...(await db.query(`insert into ${identifier(table)}(${keys.map(identifier).join(',')}) values(${values.map((_,i)=>'$'+(i+1)).join(',')})${conflict} returning *`,values)).rows)
        }else{
          const values=Object.values(rows[0]).map(value=>value && typeof value==='object'?JSON.stringify(value):value)
          const assignments=Object.keys(rows[0]).map((key,index)=>`${identifier(key)}=$${params.length+index+1}`)
          result=(await db.query(`update ${identifier(table)} set ${assignments.join(',')}${filters.length?' where '+filters.join(' and '):''} returning *`,[...params,...values])).rows
        }
        return resolve({data:single?result[0] || null:result,error:null})
      }catch(error){return Promise.resolve({data:null,error}).then(resolve,reject)}}
    };return query
  }}
}
