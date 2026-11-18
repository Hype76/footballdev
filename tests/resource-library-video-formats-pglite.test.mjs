import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {PGlite} from '@electric-sql/pglite'

test('video migration adds MP4 and MOV while preserving the private bucket, existing MIME types and20MiB limit',async()=>{
  const db=new PGlite()
  try {
    await db.exec(`create schema storage;create table storage.buckets(id text primary key,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      insert into storage.buckets values ('resource-library',false,20971520,array['application/pdf','image/gif']),('other',false,10,array['image/png']);
      create table public.resource_library_items(mime_type text,file_size_bytes integer,
        constraint resource_library_items_mime_check check(mime_type in ('application/pdf','image/gif')),
        constraint resource_library_items_size_check check(file_size_bytes>0 and file_size_bytes<=20971520));`)
    await db.exec(await readFile(new URL('../supabase/migrations/20261118131314_resource_library_video_formats.sql',import.meta.url),'utf8'))
    const bucket=(await db.query("select * from storage.buckets where id='resource-library'")).rows[0]
    assert.deepEqual(bucket,{id:'resource-library',public:false,file_size_limit:20971520,allowed_mime_types:['application/pdf','image/gif','video/mp4','video/quicktime']})
    for(const mime of ['application/pdf','image/gif','video/mp4','video/quicktime']) await db.query('insert into public.resource_library_items values ($1,20971520)',[mime])
    await assert.rejects(db.query("insert into public.resource_library_items values ('video/mp4',20971521)"),/size_check/)
    await assert.rejects(db.query("insert into public.resource_library_items values ('text/html',100)"),/mime_check/)
    assert.equal((await db.query("select allowed_mime_types from storage.buckets where id='other'")).rows[0].allowed_mime_types[0],'image/png')
  }finally{await db.close()}
})
