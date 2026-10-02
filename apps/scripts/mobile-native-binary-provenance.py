from pathlib import Path
import sys
import zipfile,plistlib,json,hashlib
root=Path(sys.argv[1]).resolve()
def digest(b):return hashlib.sha256(b).hexdigest()
def varint(b,p):
 v=0;s=0
 while True:
  x=b[p];p+=1;v|=(x&127)<<s
  if not x&128:return v,p
  s+=7
  if s>70:raise ValueError('Malformed protobuf')
def fields(b):
 p=0;r={}
 while p<len(b):
  k,p=varint(b,p);n=k>>3;w=k&7
  if w==0:v,p=varint(b,p)
  elif w==2:l,p=varint(b,p);v=b[p:p+l];p+=l
  elif w==1:v=b[p:p+8];p+=8
  elif w==5:v=b[p:p+4];p+=4
  else:raise ValueError('Unsupported wire type')
  r.setdefault(n,[]).append(v)
 return r
def text(f,n):return f.get(n,[b''])[0].decode('utf8')
def xmlnode(b):
 f=fields(b)
 if 1 not in f:return None
 e=fields(f[1][0]);attrs={}
 for a in e.get(4,[]):
  af=fields(a);attrs[text(af,2)]=text(af,3)
 return {'name':text(e,3),'attributes':attrs,'children':[v for c in e.get(5,[]) if (v:=xmlnode(c))]}
def nodes(n):
 yield n
 for c in n['children']:yield from nodes(c)
z=zipfile.ZipFile(root/'android-existing-native.archive')
manifest=z.read('base/manifest/AndroidManifest.xml');tree=xmlnode(manifest)
metadata={n['attributes']['name']:n['attributes'].get('value','') for n in nodes(tree) if n['name']=='meta-data'}
update_metadata={k:v for k,v in metadata.items() if k.startswith('expo.modules.updates.')}
app_manifest=z.read('base/assets/app.manifest');app=json.loads(app_manifest)
resources=z.read('base/resources.pb');resource_table=fields(resources);runtime_values=[]
for package in resource_table.get(2,[]):
 for type_data in fields(package).get(3,[]):
  type_fields=fields(type_data)
  if text(type_fields,2)!='string':continue
  for entry in type_fields.get(3,[]):
   entry_fields=fields(entry)
   if text(entry_fields,2)!='expo_runtime_version':continue
   for config_value in entry_fields.get(6,[]):
    value=fields(fields(config_value)[2][0]);item=fields(value[4][0]);runtime_values.append(text(fields(item[2][0]),1))
assert set(runtime_values)=={'1.0.23'},runtime_values
android={'artifactSha256':digest((root/'android-existing-native.archive').read_bytes()),'androidManifestSha256':digest(manifest),'package':tree['attributes'].get('package'),'versionName':tree['attributes'].get('versionName'),'versionCode':tree['attributes'].get('versionCode'),'updateMetadata':update_metadata,'embeddedManifestSha256':digest(app_manifest),'embeddedManifestRuntimeVersion':app.get('runtimeVersion'),'embeddedManifestProjectId':app.get('extra',{}).get('eas',{}).get('projectId')}
android.update({'resourcesSha256':digest(resources),'resolvedRuntimeVersion':runtime_values[0],'codeSigningCertificatePresent':any('SIGNING_CERTIFICATE' in k for k in update_metadata),'codeSigningMetadataPresent':any('SIGNING_METADATA' in k for k in update_metadata)})
i=zipfile.ZipFile(root/'ios-existing-native.archive');name=next(n for n in i.namelist() if n.endswith('/Expo.plist'));expo_bytes=i.read(name);expo=plistlib.loads(expo_bytes)
info_name=next(n for n in i.namelist() if n.startswith('Payload/') and n.count('/')==2 and n.endswith('/Info.plist'));info_bytes=i.read(info_name);info=plistlib.loads(info_bytes)
ios={'artifactSha256':digest((root/'ios-existing-native.archive').read_bytes()),'expoPlistSha256':digest(expo_bytes),'infoPlistSha256':digest(info_bytes),'bundleIdentifier':info.get('CFBundleIdentifier'),'appVersion':info.get('CFBundleShortVersionString'),'buildNumber':info.get('CFBundleVersion'),'updateConfiguration':expo}
ios.update({'codeSigningCertificatePresent':bool(expo.get('EXUpdatesCodeSigningCertificate')),'codeSigningMetadataPresent':bool(expo.get('EXUpdatesCodeSigningMetadata'))})
result={'android':android,'ios':ios,'schemaReference':'https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/tools/aapt2/Resources.proto','scope':'Read-only extracted compiled update configuration and archive hashes. Existing signatures/OS trust and physical-device behaviour not independently verified.'}
print(json.dumps(result,indent=2))
