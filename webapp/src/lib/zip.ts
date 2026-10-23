/** Uncompressed ZIP entries; PNG files already contain compressed image data. */
export function zipFiles(files: { name: string; bytes: Uint8Array }[]): Blob {
  const parts: BlobPart[] = [], directory: Uint8Array<ArrayBuffer>[] = [];
  let offset=0;
  const bytes=(size:number)=>new Uint8Array(size);
  const crc=(data:Uint8Array)=>{
    let value=0xffffffff;
    for (const byte of data) {
      value^=byte;
      for(let bit=0;bit<8;bit++) value=(value>>>1)^((value&1) ? 0xedb88320 : 0);
    }
    return (value^0xffffffff)>>>0;
  };
  for (const file of files) {
    const name=new TextEncoder().encode(file.name);
    if (file.bytes.length+offset>200*1024*1024) throw new Error('The export exceeds 200 MB. Export fewer views or use smaller images.');
    const checksum=crc(file.bytes), local=bytes(30+name.length), l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true); l.setUint16(4,20,true); l.setUint16(6,0x800,true);
    l.setUint32(14,checksum,true); l.setUint32(18,file.bytes.length,true); l.setUint32(22,file.bytes.length,true); l.setUint16(26,name.length,true); local.set(name,30);
    const central=bytes(46+name.length), c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x800,true);
    c.setUint32(16,checksum,true); c.setUint32(20,file.bytes.length,true); c.setUint32(24,file.bytes.length,true); c.setUint16(28,name.length,true); c.setUint32(42,offset,true); central.set(name,46);
    parts.push(local,new Uint8Array(file.bytes)); directory.push(central); offset+=local.length+file.bytes.length;
  }
  const size=directory.reduce((sum,item)=>sum+item.length,0), end=bytes(22), e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,size,true); e.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end],{type:'application/zip'});
}
