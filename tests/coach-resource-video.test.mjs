import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { RESOURCE_LIBRARY_MAX_FILE_SIZE_BYTES, validateResourceLibraryFile } from '../src/lib/resource-library-upload.js'

test('Coach supports MP4 and MOV resources without relaxing type or size limits', async () => {
  for (const [name,type] of [['video.mp4','video/mp4'], ['video.mov','video/quicktime']]) {
    assert.equal(validateResourceLibraryFile({ name,type,size:RESOURCE_LIBRARY_MAX_FILE_SIZE_BYTES }).mimeType,type)
    assert.throws(() => validateResourceLibraryFile({ name,type,size:RESOURCE_LIBRARY_MAX_FILE_SIZE_BYTES+1 }), /20 MB/)
  }
  assert.throws(() => validateResourceLibraryFile({ name:'video.mp4',type:'application/pdf',size:10 }), /not allowed/)
  assert.throws(() => validateResourceLibraryFile({ name:'video.exe',type:'video/mp4',size:10 }), /Upload a PDF/)
  const picker=await readFile('apps/coach-mobile/src/CoachNativeResourceUpload.js','utf8')
  assert.match(picker, /mediaTypes:\s*\['images', 'videos'\]/)
})
