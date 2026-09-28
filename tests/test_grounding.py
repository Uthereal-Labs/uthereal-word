"""Native grounding lifecycle regressions in a real Chromium DOM.
Run the Word server, then: python tests/test_grounding.py --url http://127.0.0.1:4183
No model or server evidence is forged by these native contract fixtures.
"""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:4173')
parser.add_argument('--adapter', help='Optional injected Cortex Word adapter path for real native bridge validation')
args = parser.parse_args()
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1512, 'height': 1100})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    from urllib.parse import urlsplit, quote
    origin = urlsplit(args.url).scheme+'://'+urlsplit(args.url).netloc
    page.goto(args.url + ('?utherealParentOrigin='+quote(origin,safe='') if args.adapter else ''), wait_until='networkidle')
    page.wait_for_function('window.quire?.ready')
    helpers = '''() => {
      window.resetGrounding = html => { quire.setReading(false); quire.store.replace(quire.createDocument('Grounding fixture',html)); };
      window.units = () => quire.grounding.inspect();
      window.groundUnit = (index, origin = {kind:'saved',revision_id:'revision-a',association_id:'association-a'}) => {
        const unit = units()[index]; const annotation = {id:crypto.randomUUID(),start:0,end:unit.text.length,quote:unit.text,claim_ids:['claim-a'],relation:'supports',origin};
        quire.grounding.assign([{object_id:unit.object_id,annotations:[annotation]}]); return annotation;
      };
      window.selectUnit = (index, start = 0, end = null) => {
        const unit = units()[index], els = [...document.querySelectorAll('#page-stack [data-uth-id]')].filter(el => el.dataset.uthId === unit.object_id);
        const nodes = els.flatMap(el => { const out=[],w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);while(w.nextNode())out.push(w.currentNode);return out; });
        const at = offset => { if(!nodes.length)return[els[0],0];for(const n of nodes){if(offset<=n.length)return[n,offset];offset-=n.length;}return[nodes.at(-1),nodes.at(-1).length]; };
        const [a,ao]=at(start),[b,bo]=at(end ?? unit.text.length),r=document.createRange();r.setStart(a,ao);r.setEnd(b,bo);
        els[0].closest('.page-content').focus();getSelection().removeAllRanges();getSelection().addRange(r);quire.editor.onSelection();return r;
      };
      window.copyGrounding = () => { const data=new DataTransfer(); document.querySelector('#page-stack').dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true})); return data; };
      window.pasteGrounding = data => quire.editor.paste({preventDefault(){},clipboardData:data});
      window.check = (value,message) => { if(!value)throw Error(message); };
    }'''
    page.evaluate(helpers)

    for fixture in json.loads((BASE/'tests/grounding-offset-fixtures.json').read_text()):
        page.evaluate('''fixture => {
          resetGrounding(fixture.html); const current=units();
          check(JSON.stringify(current.map(u=>u.text))===JSON.stringify(fixture.texts),'Canonical fixture: '+fixture.name);
          for(const span of fixture.spans)check(current[span.unit].text.slice(span.start,span.end)===span.quote,'UTF-16 fixture span');
        }''', fixture)
    print('PASS Shared canonical text and UTF-16 fixtures', flush=True)

    page.evaluate('''() => {
      resetGrounding('<p>Qualified pilot 20%.</p><p>Unchanged context.</p><table><tr><td><p>Cell 42</p><p>Second sentence</p></td><td>Other cell</td></tr></table>');
      for(let i=0;i<units().length;i++)groundUnit(i,{kind:'saved',revision_id:'revision-a',association_id:'association-'+i});
      const before=units();selectUnit(0,0,9);quire.editor.toggleMark('bold');quire.editor.setBlock('h2');quire.editor.list();
      const after=units();check(after[0].object_id===before[0].object_id,'Formatting must preserve identity');check(after.every(u=>u.grounding.length===1),'Formatting must preserve annotations');
      quire.editor.list();check(units()[0].object_id===before[0].object_id,'List removal identity');
      quire.editor.transaction('move',()=>{const first=document.querySelector('#page-stack [data-uth-id]'); first.parentElement.append(first);});
      check(units().find(u=>u.object_id===before[0].object_id).grounding.length===1,'Movement retains annotation');
      quire.editor.transaction('insert unrelated',()=>{const p=document.createElement('p');p.textContent='Inserted before';document.querySelector('#page-stack .page-content').prepend(p);});
      check(before.every(old=>units().find(u=>u.object_id===old.object_id).grounding.length===1),'Insertion retains every old unit');
    }''')
    print('PASS Formatting, list conversion, movement, unrelated insertion', flush=True)
    page.evaluate('''() => {
      resetGrounding('<p>Original 42</p>');const a=groundUnit(0),key=units()[0].object_id;
      selectUnit(0,0,0);quire.editor.insertHTML('<p>Before</p>',{block:true});check(units().find(u=>u.object_id===key).grounding[0].id===a.id,'Block insert before preserves unchanged object');
      selectUnit(units().findIndex(u=>u.object_id===key),11,11);quire.editor.insertHTML('<p>After</p>',{block:true});check(units().find(u=>u.object_id===key).grounding[0].id===a.id,'Block insert after preserves unchanged object');
      resetGrounding('<p>Original 42</p>');groundUnit(0);window.boundaryIdentity=units()[0].object_id;selectUnit(0,0,0);
    }''')
    page.keyboard.press('Enter');page.wait_for_timeout(400)
    page.evaluate("check(units().find(u=>u.object_id===boundaryIdentity).grounding.length===1,'Enter at start preserves unchanged paragraph');selectUnit(units().findIndex(u=>u.object_id===boundaryIdentity),11,11)")
    page.keyboard.press('Enter');page.wait_for_timeout(400)
    page.evaluate("check(units().find(u=>u.object_id===boundaryIdentity).grounding.length===1,'Enter at end preserves unchanged paragraph')")
    print('PASS Structural insertion and Enter at logical paragraph boundaries', flush=True)


    page.evaluate('''() => { resetGrounding('<p>Revenue 20%.</p><p>Unchanged</p>');groundUnit(0);groundUnit(1,{kind:'saved',revision_id:'revision-a',association_id:'association-b'});quire.store.history=[];selectUnit(0,8,10); }''')
    page.keyboard.insert_text('90')
    page.wait_for_timeout(400)
    page.evaluate('''async() => {
      check(units()[0].grounding.length===0,'Manual whole paragraph invalidation');check(units()[1].grounding.length===1,'Other paragraph remains grounded');
      await quire.repository.save(quire.store.document);quire.actions.undo();check(units()[0].text==='Revenue 20%.','Undo content');check(units()[0].grounding.length===1,'Undo restores annotations after autosave');
      quire.actions.redo();check(units()[0].grounding.length===0,'Redo invalidates again');selectUnit(0,8,10);
    }''')
    page.keyboard.insert_text('20')
    page.wait_for_timeout(400)
    page.evaluate("check(units()[0].text==='Revenue 20%.' && units()[0].grounding.length===0,'Manual retyping cannot resurrect provenance')")
    print('PASS Native typing, autosave Undo/Redo, manual retyping', flush=True)

    page.evaluate('''() => { resetGrounding('<table><tr><td><p>Cell 42</p><p>Other sentence</p></td><td>Keep</td></tr></table>');groundUnit(0);groundUnit(1,{kind:'saved',revision_id:'revision-a',association_id:'association-b'});selectUnit(0,5,7); }''')
    page.keyboard.insert_text('99')
    page.wait_for_timeout(400)
    page.evaluate("check(units().length===2 && units()[0].grounding.length===0 && units()[1].grounding.length===1,'Cell owns all descendant paragraphs')")
    page.evaluate('''() => {
      resetGrounding('<ul><li>Parent<ul><li>Nested 42</li></ul></li><li>Other</li></ul>');for(let i=0;i<3;i++)groundUnit(i,{kind:'saved',revision_id:'revision-a',association_id:'association-'+i});selectUnit(1,7,9);
    }''')
    page.keyboard.insert_text('99')
    page.wait_for_timeout(400)
    page.evaluate("check(units()[0].grounding.length===1 && units()[1].grounding.length===0 && units()[2].grounding.length===1,'Nested list item invalidates its own unit')")
    print('PASS Whole-cell ownership and nested list invalidation', flush=True)

    page.evaluate('''() => { resetGrounding('<p>First grounded</p><p>Second grounded</p>');groundUnit(0);groundUnit(1,{kind:'saved',revision_id:'revision-a',association_id:'association-b'});selectUnit(0,5,5); }''')
    page.keyboard.press('Enter');page.wait_for_timeout(400)
    page.evaluate('''() => { const u=units();check(new Set(u.map(u=>u.object_id)).size===u.length,'Browser-created split nodes have distinct identities');check(u.slice(0,2).every(u=>!u.grounding.length),'Split invalidates affected associations');check(u.at(-1).grounding.length===1,'Unrelated split target preserved'); }''')
    page.evaluate('''() => { resetGrounding('<p>First</p><p>Second</p>');groundUnit(0);groundUnit(1,{kind:'saved',revision_id:'revision-a',association_id:'association-b'});selectUnit(1,0,0); }''')
    page.keyboard.press('Backspace');page.wait_for_timeout(400)
    page.evaluate("check(units().every(u=>!u.grounding.length),'Merge invalidates both old objects')")
    page.evaluate('''() => {
      resetGrounding('<p>IME 42</p><p>Keep</p>');groundUnit(0);groundUnit(1,{kind:'saved',revision_id:'revision-a',association_id:'association-b'});quire.store.history=[];selectUnit(0,4,6);
      const host=document.querySelector('#page-stack .page-content');host.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      const r=getSelection().getRangeAt(0);r.deleteContents();r.insertNode(document.createTextNode('四十二'));host.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'四十二',isComposing:true}));host.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'四十二'}));
      check(!units()[0].grounding.length && units()[1].grounding.length===1,'Composition invalidates owner');quire.actions.undo();check(units()[0].grounding.length===1,'IME Undo restores recorded annotations');
    }''')
    print('PASS Enter/Backspace, browser normalization and IME transaction', flush=True)

    page.evaluate('''() => {
      const text=Array.from({length:1700},(_,i)=>'word'+i).join(' ');resetGrounding('<p>'+text+'</p>');const annotation=groundUnit(0),object=units()[0].object_id;
      check(quire.store.document.pages.length>3,'Fixture must repaginate');check(units().length===1 && units()[0].text===text,'Fragments are one logical paragraph');
      check(units()[0].locations.every((location,i,list)=>location.start===(i?list[i-1].end:0)),'Fragment UTF-16 offsets are contiguous');
      for(let i=0;i<3;i++)quire.paginator.reflow();check(units()[0].object_id===object && units()[0].grounding[0].id===annotation.id,'Repeated reflow retains identity and span');
      const d=JSON.parse(JSON.stringify(quire.store.document));quire.store.replace(quire.validateDocument(d));check(units().length===1 && units()[0].grounding[0].id===annotation.id,'Native reload preserves durable annotation');check(!quire.store.history.length && !quire.store.future.length,'Reload clears native history');
    }''')
    print('PASS Pagination, logical offsets, native round trip and fresh history', flush=True)
    persisted = page.evaluate('''async() => {await quire.repository.save(quire.store.document);return{object:units()[0].object_id,annotation:units()[0].grounding[0].id,locations:units()[0].locations.length};}''')
    page.reload(wait_until='networkidle');page.wait_for_function('window.quire?.ready');page.evaluate(helpers)
    page.evaluate('''saved=>{check(units().length===1 && units()[0].object_id===saved.object && units()[0].grounding[0].id===saved.annotation,'IndexedDB reload preserves authored identity and annotation');check(units()[0].locations.length===saved.locations,'Persisted pagination has one logical object');check(!quire.store.history.length && !quire.store.future.length,'Real reload clears Undo/Redo');}''', persisted)
    print('PASS Real IndexedDB save/reload retains grounded pagination and clears Undo', flush=True)

    page.evaluate('''() => {
      const text=Array.from({length:1100},(_,i)=>'formatword'+i).join(' ');resetGrounding('<p>'+text+'</p>');const annotation=groundUnit(0),key=units()[0].object_id;
      selectUnit(0,units()[0].locations[1].start+10,units()[0].locations[1].start+20);quire.editor.setBlock('h2');check(units().length===1 && units()[0].object_id===key && units()[0].grounding[0].id===annotation.id,'Heading formatting applies to all fragments of the logical paragraph');
      quire.editor.list();check(units().length===1 && units()[0].object_id===key && units()[0].grounding[0].id===annotation.id,'Paginated paragraph becomes one authored list item with grounding');check(document.querySelectorAll('#page-stack li').length===1,'List conversion recombines paragraph fragments before converting');
      quire.editor.list();check(units().length===1 && units()[0].object_id===key && units()[0].grounding[0].id===annotation.id,'List removal preserves logical identity across repagination');
    }''')
    print('PASS Formatting and list conversion of a paginated logical paragraph', flush=True)


    page.evaluate('''() => {
      resetGrounding('<p>Supported 42</p><p>Destination</p>');const original=groundUnit(0),source=units()[0].object_id;
      selectUnit(0);const data=copyGrounding();check(!data.getData('text/html').includes('data-uth-'),'Clipboard HTML is content-only');check(data.getData('application/x-uthereal-word-copy'),'Complete copy has a native-held handle');
      selectUnit(1,11,11);pasteGrounding(data);const copied=units().filter(u=>u.text==='Supported 42');check(copied.length===2,'Complete paragraph copy');check(copied[1].object_id!==source && copied[1].grounding[0].id!==original.id,'Copy allocates fresh identities');check(copied[1].grounding[0].origin.association_id===original.origin.association_id,'Copy preserves exact association provenance');
      const index=units().findIndex(u=>u.object_id===source);selectUnit(index,0,9);const partial=copyGrounding();check(!partial.getData('application/x-uthereal-word-copy'),'Partial copy has no trusted handle');
      selectUnit(units().length-1,0,0);pasteGrounding(partial);check(units().filter(u=>u.text==='Supported').every(u=>!u.grounding.length),'Partial copy strips annotations');
      selectUnit(units().findIndex(u=>u.object_id===source));const external=copyGrounding();external.setData('text/html','<p data-uth-id="injected" data-uth-grounding="[]">Forged</p>');
      quire.store.replace(quire.createDocument('Other artifact','<p>Target</p>'));selectUnit(0,6,6);pasteGrounding(external);check(units().every(u=>!u.grounding.length && u.object_id!=='injected'),'Cross-artifact handle and HTML cannot establish grounding');
    }''')
    print('PASS Complete/partial/cross-artifact copying and external HTML stripping', flush=True)
    page.context.grant_permissions(['clipboard-read','clipboard-write'])
    page.evaluate('''async() => {
      resetGrounding('<table><tr><td>A 42</td><td>B 50</td></tr><tr><td>C 60</td><td>D 70</td></tr></table><p>Target</p>');for(let i=0;i<4;i++)groundUnit(i,{kind:'saved',revision_id:'revision-a',association_id:'copy-cell-'+i});
      const table=document.querySelector('#page-stack table'),r=document.createRange();r.selectNodeContents(table);getSelection().removeAllRanges();getSelection().addRange(r);quire.editor.onSelection();
      const data=copyGrounding();selectUnit(4,6,6);pasteGrounding(data);check(document.querySelectorAll('#page-stack table').length===2,'Complete table copy preserves table structure');check(document.querySelectorAll('#page-stack table')[1].rows.length===2,'Copied table retains rows');check(units().slice(-4).every(u=>u.grounding.length===1),'All copied table cells inherit grounding');
      resetGrounding('<p>Toolbar 42</p><p>Target</p>');groundUnit(0);selectUnit(0);await quire.editor.copyToClipboard();const items=await navigator.clipboard.read();check(items.some(item=>item.types.includes('web application/x-uthereal-word-copy')),'Native toolbar clipboard carries held copy handle');
      selectUnit(1,6,6);await quire.editor.pasteFromClipboard();check(units().filter(u=>u.text==='Toolbar 42').length===2 && units().filter(u=>u.text==='Toolbar 42').every(u=>u.grounding.length===1),'Toolbar complete native paste retains validated association');
    }''')
    print('PASS Complete table structure and native toolbar clipboard provenance', flush=True)
    page.evaluate("resetGrounding('<p>Keyboard 42</p><p>Target</p>');groundUnit(0);selectUnit(0)")
    page.keyboard.press('ControlOrMeta+C')
    page.evaluate('selectUnit(1,6,6)')
    page.keyboard.press('ControlOrMeta+V')
    page.wait_for_timeout(400)
    page.evaluate("check(units().filter(u=>u.text==='Keyboard 42').length===2 && units().filter(u=>u.text==='Keyboard 42').every(u=>u.grounding.length===1),'Real keyboard complete-object copy/paste preserves native provenance')")
    print('PASS Real keyboard complete-object copy and paste', flush=True)



    page.evaluate('''async() => {
      resetGrounding('<p>Pending supported 42</p><p>Other</p>');const origin={kind:'agent',job_id:'job-a',steering_revision:1,sequence:2,declaration_id:'declaration-a'},a=groundUnit(0,origin),target=units()[0].object_id;
      const snapshot=JSON.parse(JSON.stringify(quire.store.document));selectUnit(0);const copy=copyGrounding();selectUnit(1,5,5);pasteGrounding(copy);
      selectUnit(0,18,20);quire.editor.insertText('99');const history=quire.store.history.length,revision=quire.store.revision;
      const receipt={object_id:target,annotation_id:a.id,submitted_origin:origin,origin:{kind:'saved',revision_id:'revision-new',association_id:'association-new'}};
      quire.grounding.ack({receipts:[receipt],submitted_snapshot:snapshot});check(!units()[0].grounding.length,'Late save cannot resurrect manually invalidated live annotation');check(quire.store.history.length===history && quire.store.revision===revision,'Ack has no history step or content revision');
      check(units().find(u=>u.object_id!==target && u.text==='Pending supported 42').grounding[0].origin.kind==='saved','Ack updates exact complete copy');
      quire.actions.undo();check(units()[0].grounding[0].origin.revision_id==='revision-new','Ack updates restored history');
      const again=quire.grounding.copiedHTML(copy.getData('application/x-uthereal-word-copy'));check(again.includes('revision-new'),'Ack updates native clipboard record');
      const html=quire.exportHTML();check(!html.includes('data-uth-') && !html.includes('association-new'),'HTML export strips private metadata');
      const zip=await quire.exportDocx().arrayBuffer();check(!new TextDecoder().decode(zip).includes('association-new'),'DOCX export omits grounding metadata');
      const imported=await quire.importFile(new File([JSON.stringify(quire.store.document)],'content.document'));check(imported.id!==quire.store.document.id,'Imported document receives fresh artifact identity');
      quire.store.replace(imported);check(units().every(u=>!u.grounding.length && u.object_id!==target),'Native import is content-only with fresh objects');
    }''')
    print('PASS Race-safe acknowledgements across history/copy, import/export privacy', flush=True)

    page.evaluate('''() => {
      resetGrounding('<p>Original supported 42</p><p>Destination</p>');const origin={kind:'saved',revision_id:'revision-before',association_id:'association-before'},original=groundUnit(0,origin),source=units()[0].object_id;
      selectUnit(0);const copy=copyGrounding();selectUnit(1,11,11);pasteGrounding(copy);
      const copied=units().find(unit=>unit.object_id!==source && unit.text==='Original supported 42'),snapshot=JSON.parse(JSON.stringify(quire.store.document));
      const copyReceipt={object_id:copied.object_id,annotation_id:copied.grounding[0].id,submitted_origin:origin,origin:{kind:'saved',revision_id:'revision-after',association_id:'association-copy'}};
      const originalReceipt={object_id:source,annotation_id:original.id,submitted_origin:origin,origin:{kind:'saved',revision_id:'revision-after',association_id:'association-original'}};
      const history=quire.store.history.length,revision=quire.store.revision;
      quire.grounding.ack({submitted_snapshot:snapshot,receipts:[copyReceipt,originalReceipt]});
      check(units().find(unit=>unit.object_id===source).grounding[0].origin.association_id==='association-original','Original receives its exact canonical receipt even when copy receipt is first');
      check(units().find(unit=>unit.object_id===copied.object_id).grounding[0].origin.association_id==='association-copy','Submitted copy receives its own canonical receipt');
      check(quire.store.history.length===history && quire.store.revision===revision,'Exact receipt acknowledgement adds no content/history step');
      quire.actions.undo();check(units().find(unit=>unit.object_id===source).grounding[0].origin.association_id==='association-original','Original history retains exact canonical receipt');
      quire.actions.redo();check(units().find(unit=>unit.object_id===copied.object_id).grounding[0].origin.association_id==='association-copy','Copied history retains its own canonical receipt');

      resetGrounding('<p>Original supported 42</p><p>Destination</p>');const pending=groundUnit(0,origin),pendingSource=units()[0].object_id,pendingSnapshot=JSON.parse(JSON.stringify(quire.store.document));
      selectUnit(0);const during=copyGrounding();selectUnit(1,11,11);pasteGrounding(during);const inFlight=units().find(unit=>unit.object_id!==pendingSource && unit.text==='Original supported 42');
      quire.grounding.ack({submitted_snapshot:pendingSnapshot,receipts:[{object_id:pendingSource,annotation_id:pending.id,submitted_origin:origin,origin:{kind:'saved',revision_id:'revision-inflight',association_id:'association-inflight'}}]});
      check(units().find(unit=>unit.object_id===inFlight.object_id).grounding[0].origin.association_id==='association-inflight','Complete copy absent submitted snapshot inherits source canonical receipt');
      check(quire.grounding.copiedHTML(during.getData('application/x-uthereal-word-copy')).includes('association-inflight'),'In-flight native clipboard retains canonical source provenance');

      resetGrounding('<p>Original supported 42</p><p>Destination</p>');const unchanged=groundUnit(0,origin),unchangedSource=units()[0].object_id;
      selectUnit(0);const another=copyGrounding();selectUnit(1,11,11);pasteGrounding(another);const submittedCopy=units().find(unit=>unit.object_id!==unchangedSource && unit.text==='Original supported 42'),incompleteSnapshot=JSON.parse(JSON.stringify(quire.store.document));
      quire.grounding.ack({submitted_snapshot:incompleteSnapshot,receipts:[{object_id:submittedCopy.object_id,annotation_id:submittedCopy.grounding[0].id,submitted_origin:origin,origin:{kind:'saved',revision_id:'revision-copy-only',association_id:'association-copy-only'}}]});
      check(units().find(unit=>unit.object_id===unchangedSource).grounding[0].origin.association_id==='association-before','Submitted original never falls back to another object receipt when its own is absent');
      check(units().find(unit=>unit.object_id===submittedCopy.object_id).grounding[0].origin.association_id==='association-copy-only','Other submitted copy still accepts exact receipt');
    }''')
    print('PASS Canonical ACK selectors distinguish submitted originals/copies and preserve in-flight copy fallback', flush=True)

    page.evaluate('''() => {
      resetGrounding('<p>Original 42</p><p>Other</p>');groundUnit(0);const before=JSON.stringify(quire.store.document),history=quire.store.history.length;
      const next=JSON.parse(before),box=document.createElement('div');box.innerHTML=next.pages[0].html;box.querySelector('p').textContent='Rewritten 42';next.pages[0].html=box.innerHTML;const object=units()[0].object_id;
      try{quire.grounding.applyDocument(next,[{object_id:object,annotations:[{id:'invalid',start:0,end:12,quote:'wrong'}]}]);throw Error('Invalid assignment accepted');}catch(error){check(!error.message.includes('accepted'),'Invalid assignment rejected');}
      check(JSON.stringify(quire.store.document)===before && quire.store.history.length===history,'Invalid annotation rolls back all prose');
      const annotation={id:crypto.randomUUID(),start:0,end:12,quote:'Rewritten 42',claim_ids:['claim-a'],relation:'derived',origin:{kind:'agent',job_id:'job-a',steering_revision:0,sequence:1,declaration_id:'decl-a'}};
      quire.grounding.applyDocument(next,[{object_id:object,annotations:[annotation]}]);quire.store.emit('replace',{kind:'agent'});check(units()[0].grounding[0].id===annotation.id,'Explicit agent replacement retained');check(quire.store.history.length===history+1,'Content and annotations commit once');quire.actions.undo();check(units()[0].text==='Original 42' && units()[0].grounding.length===1,'Atomic Undo restores prior content and grounding');
    }''')
    print('PASS Atomic agent annotations and precommit validation', flush=True)
    if args.adapter:
        page.add_script_tag(path=args.adapter)
        page.evaluate('''() => {
          window.bridgeRequest = (method,payload={}) => new Promise(resolve => {
            const requestId=crypto.randomUUID(),listener=event=>{if(event.data?.direction==='response' && event.data.requestId===requestId){removeEventListener('message',listener);resolve(event.data);}};
            addEventListener('message',listener);window.postMessage({channel:'uthereal-office',version:1,direction:'request',instance_id:window.bridgeInstance,requestId,method,payload},location.origin);
          });
        }''')
        page.evaluate('''async() => {
          const connect=await bridgeRequest('connect');window.bridgeInstance=connect.result.instance_id;check(connect.result.capabilities.includes('grounding_lifecycle_v2'),'Bridge lifecycle capability');
          resetGrounding('<p>Pilot may save 20%.</p><p>Preserved context.</p>');groundUnit(0);groundUnit(1,{kind:'saved',revision_id:'revision-a',association_id:'association-b'});
          const inspected=await bridgeRequest('inspect');check(inspected.ok && inspected.result.grounding_objects.length===2,'Logical bridge inspection');
          const target=inspected.result.blocks[0],text='Il pilota può risparmiare il 20%.',origin={kind:'agent',job_id:'job-a',steering_revision:0,sequence:1,declaration_id:'attempt:0'};
          const annotation={id:crypto.randomUUID(),start:0,end:text.length,quote:text,claim_ids:['claim-a'],relation:'derived',origin};
          const payload={expected_engine_revision:inspected.result.engine_revision,operations:[{op:'replace_text',target,start:0,end:target.raw_text.length,expected_text:target.raw_text,text}],grounding_assignments:[{object_id:target.object_id,annotations:[{...annotation,quote:'invalid'}]}]};
          const before=JSON.stringify(quire.store.document),history=quire.store.history.length,failed=await bridgeRequest('apply',payload);
          check(!failed.ok && failed.error_phase==='precommit','Invalid grounding fails before commit');check(JSON.stringify(quire.store.document)===before && quire.store.history.length===history,'Bridge invalid assignment leaves prose untouched');
          payload.grounding_assignments[0].annotations=[annotation];const applied=await bridgeRequest('apply',payload);check(applied.ok,'Real native bridge apply: '+applied.error);
          check(units()[0].text===text && units()[0].grounding[0].id===annotation.id && units()[1].grounding.length===1,'Agent content and support commit together');check(quire.store.history.length===history+1,'One native bridge history step');
          const snapshot=JSON.parse(JSON.stringify(quire.store.document)),ack=await bridgeRequest('ack_grounding',{submitted_snapshot:snapshot,receipts:[{object_id:target.object_id,annotation_id:annotation.id,submitted_origin:origin,origin:{kind:'saved',revision_id:'revision-bridge',association_id:'association-bridge'}}]});check(ack.ok && units()[0].grounding[0].origin.kind==='saved','Bridge canonical acknowledgement');
          const current=await bridgeRequest('inspect'),only=await bridgeRequest('apply',{expected_engine_revision:current.result.engine_revision,operations:[],grounding_assignments:[{object_id:target.object_id,annotations:[]}]});check(only.ok && !units()[0].grounding.length,'Annotation-only native bridge apply');
          quire.actions.undo();check(units()[0].grounding[0].origin.kind==='saved','Annotation-only bridge Undo');
          const read=await bridgeRequest('read'),legacy=await bridgeRequest('load',{content:{...read.result,grounding_contract:undefined}});check(!legacy.ok && legacy.error==='GROUNDING_CONTRACT_INCOMPATIBLE','Internal loads enforce hard cut');
        }''')
        print('PASS Real Cortex bridge capability, staged atomic edit, annotations-only apply, ack and hard cut', flush=True)
        page.evaluate('''async() => {
          window.sourceClicks=[];addEventListener('message',event=>{if(event.data?.event==='view-sources')sourceClicks.push(event.data);});
          const text=Array.from({length:1500},(_,i)=>'sourceword'+i).join(' ');resetGrounding('<p>'+text+'</p>');groundUnit(0);const object=units()[0].object_id;
          const markers=[{anchor:{kind:'quire',object_id:object,page_id:'deliberately-wrong',block_path:[999],start:0,end:text.length,quote:text}}];
          const initial=await bridgeRequest('set_grounding_markers',{markers});check(initial.ok && initial.result.rendered===1,'One source group for a logical paragraph spanning pages');
          const previousFragments=units()[0].locations.length;quire.store.document.layout.height=800;document.documentElement.style.setProperty('--paper-height','800px');quire.paginator.reflow();quire.store.document.pages=quire.paginator.getPages();check(units()[0].locations.length>previousFragments,'Fixture changes actual pagination');
          document.querySelectorAll('#page-stack .paper-slot')[1].scrollIntoView({block:'center'});const after=await bridgeRequest('set_grounding_markers',{markers});check(after.result.rendered===1,'Source marker resolves object after repagination independent of old page/path');
          document.querySelector('button[aria-label="View sources for paragraph"]').click();await new Promise(resolve=>setTimeout(resolve,20));check(sourceClicks.at(-1).targets.length===1 && sourceClicks.at(-1).targets[0].object_id===object,'Source click emits exact logical object ID');
          resetGrounding('<table><tr><td>One 42</td><td>Two 50</td></tr><tr><td>Three 60</td><td>Four 70</td></tr></table>');for(let i=0;i<4;i++)groundUnit(i,{kind:'saved',revision_id:'revision-a',association_id:'cell-'+i});
          const cells=units(),tableMarkers=cells.map(unit=>({anchor:{kind:'quire',object_id:unit.object_id,start:0,end:unit.text.length,quote:unit.text}}));
          const grouped=await bridgeRequest('set_grounding_markers',{markers:tableMarkers});check(grouped.result.rendered===1,'Cell associations aggregate into one table source sparkle');
          document.querySelector('button[aria-label="View sources for table"]').click();await new Promise(resolve=>setTimeout(resolve,20));check(sourceClicks.at(-1).targets.length===4 && sourceClicks.at(-1).targets.every(target=>cells.some(cell=>cell.object_id===target.object_id)),'Table source click emits each cited cell identity');
          selectUnit(0,0,1);quire.editor.insertText('Changed');const stale=await bridgeRequest('set_grounding_markers',{markers:tableMarkers.slice(0,1)});check(stale.result.rendered===0,'Manually invalidated object cannot show stale source sparkle');
        }''')
        print('PASS Repaginated paragraph source marker and table sparkle grouping with exact object clicks', flush=True)

    assert not errors, errors
    browser.close()
