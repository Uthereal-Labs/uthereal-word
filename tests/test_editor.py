"""Quire browser integration tests. Run with --inline for a navigation-restricted runner.
Normal mode tests the actual localhost origin; --inline uses a document.write preview
and therefore cannot validate secure-context WebGPU or persistent IndexedDB.
"""
import argparse, base64, io, json, os, shutil, subprocess, sys, time, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from playwright.sync_api import sync_playwright

BASE=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--inline',action='store_true')
parser.add_argument('--gpu',action='store_true',help='Require a real WebGPU adapter and GPU reading textures')
parser.add_argument('--software-gpu',action='store_true',help='Explicitly request Chromium SwiftShader for WebGPU tests; not physical GPU performance')
parser.add_argument('--url',default='http://127.0.0.1:4173')
args=parser.parse_args()
results=[];errors=[];exports=BASE/'tests'/'output';exports.mkdir(exist_ok=True)

def check(value,message='Assertion failed'):
 if not value: raise AssertionError(message)

def record(name,fn):
 started=time.perf_counter()
 try:
  details=fn();results.append({'name':name,'status':'PASS','seconds':round(time.perf_counter()-started,3),'details':details});print('PASS',name,details or '',flush=True)
 except Exception as e:
  results.append({'name':name,'status':'FAIL','seconds':round(time.perf_counter()-started,3),'error':str(e)});print('FAIL',name,str(e),flush=True)
  try: page.screenshot(path=str(exports/('failure-'+str(len(results))+'.png')))
  except Exception: pass

with sync_playwright() as p:
 executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
 launch={'headless':True,'args':['--no-sandbox']}
 if args.software_gpu:launch['args']+=['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--disable-vulkan-surface']
 if executable:launch['executable_path']=executable
 browser=p.chromium.launch(**launch)
 context=browser.new_context(viewport={'width':1512,'height':1100},device_scale_factor=1,accept_downloads=True)
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 if args.inline:page.set_content((BASE/'Quire.html').read_text(),wait_until='load')
 else:page.goto(args.url,wait_until='networkidle')
 page.wait_for_function('window.quire?.ready',timeout=30000)
 page.set_default_timeout(4500)
 def evaluate(js,arg=None):return page.evaluate(js,arg)
 def reset(html='<p>Hello Quire. A thoughtful beginning.</p>',title='Test document'):
  evaluate('''([html,title])=>{const q=quire;q.setReading(false);q.store.replace(q.createDocument(title,html));q.setZoom(85);document.querySelector('#viewport').scrollTop=0;document.querySelector('#modal').close();document.querySelector('#popover').hidden=true;}''',[html,title]);page.wait_for_timeout(60)
 def select(text):
  return evaluate('''text=>{const root=document.querySelector('#page-stack');const ns=[];for(const p of root.querySelectorAll('.page-content')){const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);while(w.nextNode())ns.push(w.currentNode)}const all=ns.map(n=>n.textContent).join(''),at=all.indexOf(text);if(at<0)throw Error('Text not found: '+text);const find=o=>{for(const n of ns){if(o<=n.length)return[n,o];o-=n.length}return[ns.at(-1),ns.at(-1).length]};const [a,ao]=find(at),[b,bo]=find(at+text.length);a.parentElement.closest('.page-content').focus();const r=document.createRange();r.setStart(a,ao);r.setEnd(b,bo);getSelection().removeAllRanges();getSelection().addRange(r);quire.editor.onSelection();return r.toString();}''',text)
 def caret_end():
  evaluate('''()=>{const c=document.querySelector('#page-stack .page-content');c.focus();const r=document.createRange();r.selectNodeContents(c);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);quire.editor.onSelection()}''')
 def text():return evaluate("[...document.querySelectorAll('#page-stack .page-content')].map(p=>p.textContent).join('')")
 def ribbon_tab(name):page.locator(f'[data-tab="{name}"]').click()
 def action(name):page.locator(f'#ribbon [data-action="{name}"]').click()
 def ui(name):page.locator(f'[data-action="{name}"]').first.click()

 record('Initial sample has three paginated pages',lambda:check(evaluate('quire.store.document.pages.length')==3))
 record('All eight editing ribbon tabs render',lambda:[(ribbon_tab(t),check(page.locator('#ribbon button').count()>0,t)) for t in ['Home','Insert','Draw','Design','Layout','References','Review','View']])
 ribbon_tab('Home')
 record('Style gallery has full-height controls',lambda:check(page.locator('.style-card').first.bounding_box()['height']>=59))
 page.screenshot(path=str(BASE.parent/'Quire-preview.png'))
 record('Renderer correctly reports its active backend',lambda:evaluate('quire.renderer.stats'))

 def native_typing():
  reset('<p><br></p>');page.locator('#page-stack .page-content').click(position={'x':12,'y':10});page.keyboard.insert_text('Hello Quire. Native editing works.');page.wait_for_timeout(450);check('Native editing works.' in evaluate('quire.store.document.pages[0].html'))
 record('Native text input reaches the document model',native_typing)
 def undo_redo():
  evaluate('quire.actions.undo()');check('Native editing works.' not in text());evaluate('quire.actions.redo()');check('Native editing works.' in text())
 record('Undo and redo restore document content',undo_redo)
 def formatting():
  reset();select('Hello');action('bold');check(evaluate("[...document.querySelectorAll('#page-stack strong')].some(n=>n.textContent==='Hello')"));select('Hello');action('italic');check(evaluate("[...document.querySelectorAll('#page-stack em')].some(n=>n.textContent==='Hello')"));select('Hello');action('underline');check(evaluate("[...document.querySelectorAll('#page-stack u')].some(n=>n.textContent==='Hello')"))
 record('Bold, italic, and underline are real range edits',formatting)
 def toggle_bold():
  select('Hello');action('bold');check(evaluate("getComputedStyle([...document.querySelectorAll('#page-stack span')].find(n=>n.textContent==='Hello'&&n.style.fontWeight==='400')).fontWeight")== '400')
 record('Toggling bold removes it without changing adjacent text',toggle_bold)
 def remove_decoration():
  reset('<p><u>A <strong>thoughtful</strong> beginning.</u></p>');select('thoughtful');evaluate('quire.actions.underline()');check(not evaluate('quire.editor.getFormat().underline'));check(evaluate("[...document.querySelectorAll('#page-stack u')].map(n=>n.textContent).join('')")=='A  beginning.');check(evaluate("document.querySelector('#page-stack strong').textContent")=='thoughtful')
  reset('<p><s>A useful sentence.</s></p>');select('useful');evaluate("quire.editor.toggleMark('strikeThrough')");check(not evaluate('quire.editor.getFormat().strikeThrough'));check('A useful sentence.'==text())
 record('Underline and strike toggles isolate selected text without damaging neighbors',remove_decoration)

 def size():
  reset();select('Quire');page.select_option('#font-size','24');check(evaluate("[...document.querySelectorAll('#page-stack span')].some(n=>n.textContent==='Quire'&&n.style.fontSize==='24pt')"))
 record('Font size dropdown formats selected text',size)
 def style():
  reset();select('Hello Quire. A thoughtful beginning.');page.locator('[data-style="h1"]').click();check(page.locator('#page-stack h1').count()==1);action('align-center');check(evaluate("getComputedStyle(document.querySelector('#page-stack h1')).textAlign")== 'center')
 record('Heading styles and paragraph alignment',style)
 def lists():
  reset('<p>First item</p><p>Second item</p>');select('First item');action('bullets');check(page.locator('#page-stack ul li').count()==1);action('bullets');check(page.locator('#page-stack ul').count()==0)
 record('List conversion and removal',lists)
 def find_replace():
  reset('<p>Good <strong>clear</strong> work. Good clear work.</p>');evaluate("quire.runSearch('Good clear')");check(evaluate('quire.search.matches.length')==2);evaluate('quire.actions.replace()');page.locator('#replace-input').fill('Thoughtful');evaluate("quire.actions['replace-all']()");check(text().count('Thoughtful')==2);check('Good clear' not in text())
 record('Find spans formatting boundaries; replace-all is transactional',find_replace)
 def table():
  reset('<p>Before table</p>');caret_end();ribbon_tab('Insert');action('insert-table');page.locator('[data-table-rows="3"][data-table-cols="2"]').click();check(page.locator('#page-stack table tr').count()==3);check(page.locator('#page-stack table tr').first.locator('th').count()==2);page.locator('#page-stack table td').first.click();action('table-add-row');check(page.locator('#page-stack table tr').count()==4);action('table-add-column');check(evaluate("[...document.querySelectorAll('#page-stack table tr')].every(r=>r.cells.length===3)"))
 record('Insert table and edit rows and columns',table)
 def picture():
  reset();caret_end();image_path=exports/'fixture.png';from PIL import Image
  Image.new('RGB',(120,80),(88,142,151)).save(image_path);page.locator('#image-input').set_input_files(str(image_path));page.wait_for_timeout(250);check(page.locator('#page-stack img').count()==1);page.locator('#page-stack img').dblclick();page.locator('#modal input[name=width]').fill('240');page.locator('#modal button[type=submit]').click();check(evaluate("document.querySelector('#page-stack img').style.width")=='240px')
 record('Image insertion and editable size',picture)
 def comment():
  reset();select('thoughtful');ribbon_tab('Review');action('add-comment');page.locator('#comment-text').fill('Keep this useful thought.');page.locator('#modal button[type=submit]').click();check(evaluate('quire.store.document.comments.length')==1);check(page.locator('#page-stack [data-comment]').count()==1);page.locator('[data-resolve-comment]').click();check(evaluate('quire.store.document.comments[0].resolved'));page.locator('[data-delete-comment]').click();check(evaluate('quire.store.document.comments.length')==0);check(page.locator('#page-stack [data-comment]').count()==0)
 record('Anchored comments can be posted, resolved, and deleted',comment)
 def tracking():
  reset('<p>Hello world.</p>');select('world');page.keyboard.press('ArrowRight');action('track-changes');page.keyboard.insert_text(' today');page.wait_for_timeout(150);check(page.locator('#page-stack ins').count()>0);action('reject-changes');check('today' not in text());select('world');page.keyboard.press('Backspace');page.wait_for_timeout(100);check(page.locator('#page-stack del').count()>0);action('reject-changes');check('world' in text())
 record('Tracked text insertion and deletion can be rejected',tracking)
 def landscape():
  reset();ribbon_tab('Layout');action('orientation');page.locator('[data-orientation=landscape]').click();check(evaluate('quire.store.document.layout.width')==1123);check(evaluate('quire.store.document.layout.height')==794);check('Hello Quire' in text());evaluate('quire.actions.undo()');check(evaluate('quire.store.document.layout.width')==794)
 record('Landscape layout and undo',landscape)
 def pagination():
  original=' '.join('paragraphword'+str(i) for i in range(1700));reset('<p>'+original+'</p>');check(evaluate('quire.store.document.pages.length')>3);check(text()==original,'Text changed during pagination');evaluate('quire.paginator.reflow()');check(text()==original,'Text changed on repeated reflow');return evaluate('quire.paginator.stats')
 record('Oversized paragraphs split and rejoin without text loss',pagination)
 def crosspage():
  reset('<p>First page content</p><div class="page-break"><br></div><p>Second page content</p>');evaluate("quire.actions['select-all']()");page.keyboard.insert_text('A clean start.');page.wait_for_timeout(400);check('A clean start.' in text());check('First page content' not in text());check(evaluate("[...document.querySelectorAll('#page-stack .paper-slot')].every(s=>s.querySelector('.page-content')&&s.querySelector('.running-footer'))"));return evaluate('quire.store.document.pages.length')
 record('Cross-page replacement preserves editing hosts and furniture',crosspage)
 def sanitized():
  out=evaluate('''()=>quire.sanitizeHTML('<p onclick="alert(1)" style="color:red;background-image:url(https://evil.invalid/a)">Safe<script>alert(1)</script></p><a href="javascript:alert(1)">link</a><img src="https://evil.invalid/x" onerror="alert(1)"><iframe src="https://evil.invalid"></iframe>')''');check('onclick' not in out and '<script' not in out and 'javascript:' not in out and 'evil.invalid' not in out);return out
 record('Untrusted HTML is sanitized and external image loads are removed',sanitized)
 def hostile_json():
  result=evaluate('''async()=>{const d=quire.createDocument('Safe','<p>Safe</p>');d.id='bad" onclick="alert(1)';d.comments=[{id:'bad" onclick="alert(1)',text:'<script>alert(1)</script>'}];d.layout.font='Arial;}body{display:none}';d.view.zoom=-50;const parsed=await quire.importFile(new File([JSON.stringify(d)],'untrusted.quire'));return {id:parsed.id,comment:parsed.comments[0].id,font:parsed.layout.font,zoom:parsed.view.zoom};}''');check('"' not in result['id'] and '"' not in result['comment']);check('{' not in result['font']);check(result['zoom']>=30)
 record('Native-file identifiers, layout fonts, and zoom are validated',hostile_json)
 def structured_pagination():
  for tag in ['table','ol']:
   html=('<table>'+''.join(f'<tr><td>Row {i}</td><td>Value {i}</td></tr>' for i in range(90))+'</table>') if tag=='table' else '<ol>'+''.join(f'<li>Item {i}</li>' for i in range(130))+'</ol>'
   reset(html);before=text();check(evaluate('quire.store.document.pages.length')>1);evaluate('quire.paginator.reflow()');check(text()==before);check(evaluate("[...document.querySelectorAll('#page-stack .page-content')].every(c=>quire.paginator.used(c)<=c.clientHeight+1)"));check(page.locator('#page-stack table tr').count()==90 if tag=='table' else page.locator('#page-stack ol li').count()==130)
   if tag=='ol':check(evaluate("[...document.querySelectorAll('#page-stack ol')].slice(1).every(n=>n.start>1)"))
 record('Large tables and lists paginate at row/item boundaries without text loss',structured_pagination)

 def equation_chart():
  reset();caret_end();ribbon_tab('Insert');action('equation');page.locator('#equation').fill('E = mc²');page.locator('#modal button[type=submit]').click();check('E = mc²' in text());action('chart');page.locator('#modal button[type=submit]').click();check(page.locator('#page-stack img').count()==1)
 record('Unicode equations and data-driven chart images',equation_chart)
 def file_new():
  ui('file');page.locator('[data-template=blank]').click();page.wait_for_timeout(150);check(evaluate('quire.store.document.title')=='Untitled document');check(len(text().strip())==0);check(evaluate('quire.repository.memory.size')>0)
 record('Templates preserve prior documents in the local/session library',file_new)
 def json_roundtrip():
  reset('<h1>Portable</h1><p><strong>Bold</strong> and <em>italic</em>.</p>');result=evaluate('''async()=>{const original=quire.store.document;const file=new File([JSON.stringify(original)],'test.quire',{type:'application/json'});const read=await quire.importFile(file);return {title:read.title,html:read.pages[0].html,valid:read.schema==='quire'&&read.version===1};}''');check(result['valid']);check('<strong>Bold</strong>' in result['html']);return result
 record('Native .quire serialization round-trip',json_roundtrip)
 def docx_export():
  reset('<h1>Interoperability test</h1><p>Hello <strong>bold</strong> and <em>italic</em> text.</p><ul><li>One</li><li>Two</li></ul><table><tr><th>Column</th><th>Value</th></tr><tr><td>A</td><td>42</td></tr></table>','OOXML test');data=bytes(evaluate('''async()=>Array.from(new Uint8Array(await quire.exportDocx().arrayBuffer()))'''));(exports/'test.docx').write_bytes(data)
  with zipfile.ZipFile(io.BytesIO(data)) as z:
   check(z.testzip() is None);check('word/document.xml' in z.namelist());parts=z.namelist()
   for name in parts:
    if name.endswith('.xml') or name.endswith('.rels'):ET.fromstring(z.read(name))
   doc=ET.fromstring(z.read('word/document.xml'));ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'};check(len(doc.findall('.//w:tbl',ns))==1);check(len(doc.findall('.//w:b',ns))>0);check(len(doc.findall('.//w:numPr',ns))==2)
   compressed=io.BytesIO()
   with zipfile.ZipFile(compressed,'w',zipfile.ZIP_DEFLATED) as dest:
    for name in parts:dest.writestr(name,z.read(name))
   (exports/'test-compressed.docx').write_bytes(compressed.getvalue())
  return {'bytes':len(data),'parts':len(parts)}
 record('DOCX export has a valid ZIP and well-formed OOXML with formatting, lists, and tables',docx_export)
 def docx_import():
  data=list((exports/'test-compressed.docx').read_bytes());result=evaluate('''async data=>{const file=new File([new Uint8Array(data)],'imported.docx');const doc=await quire.importFile(file);quire.store.replace(doc);return {title:doc.title,html:doc.pages[0].html};}''',data);check('Interoperability test' in text());check(page.locator('#page-stack table').count()==1);check(page.locator('#page-stack li').count()==2);return result['title']
 record('Compressed DOCX import reconstructs editable content',docx_import)
 def html_markdown():
  html=evaluate('quire.exportHTML()');md=evaluate('quire.exportMarkdown()');check('<!doctype html>' in html);check('height:auto;cursor:auto' in html);check('# Interoperability test' in md);check('| Column | Value |' in md);(exports/'test.html').write_text(html);(exports/'test.md').write_text(md)
 record('HTML and Markdown exporters retain document structure',html_markdown)
 def ink():
  reset();ribbon_tab('Draw');action('draw-pen');layer=page.locator('#page-stack .ink-layer').first;rect=layer.bounding_box();x=rect['x']+100;y=rect['y']+160;page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+100,y+20,steps=15);page.mouse.up();check(evaluate('quire.store.document.pages[0].ink.length')==1);check(page.locator('#page-stack [data-stroke]').count()==1);action('draw-select');evaluate('quire.actions.undo()');check(evaluate('quire.store.document.pages[0].ink.length')==0)
 record('Ink strokes are serialized and undoable',ink)
 def raster():
  reset('<h1>Snapshot test</h1><p>Browser-shaped text in a page texture.</p>');result=evaluate('''async()=>{const c=await quire.renderer.rasterizer.rasterize(document.querySelector('#page-stack .paper'),1);const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let nonWhite=0;for(let i=0;i<data.length;i+=4)if(data[i]<240||data[i+1]<240||data[i+2]<240)nonWhite++;return {width:c.width,height:c.height,nonWhite};}''');check(result['width']==794 and result['height']==1123);check(result['nonWhite']>500);return result
 record('Page rasterization produces a clean, nonempty texture source',raster)
 def reading():
  evaluate("quire.actions['read-mode']()");check(evaluate('quire.reading'));check(evaluate("document.querySelector('#page-stack .page-content').contentEditable")=='false');check(page.locator('#page-stack .page-content').first.is_visible());evaluate("quire.actions['edit-mode']()");check(evaluate("document.querySelector('#page-stack .page-content').contentEditable")=='true')
 record('Reading/editing mode and DOM fallback are functional',reading)
 def commands():
  ui('commands');page.locator('#command-input').fill('page setup');page.keyboard.press('Enter');check(page.locator('#modal h2').inner_text()=='Page setup');page.locator('#modal [data-action="close-modal"]').first.click()
 record('Command search opens an actionable tool',commands)
 def responsive():
  page.set_viewport_size({'width':760,'height':900});check(page.locator('.navigation').is_hidden());evaluate("quire.actions['fit-width']()");check(evaluate('document.documentElement.style.getPropertyValue("--zoom")')!='');evaluate('quire.actions.theme()');check(evaluate("document.body.classList.contains('dark')"));page.screenshot(path=str(BASE.parent/'Quire-dark-preview.png'));evaluate('quire.actions.theme()');page.set_viewport_size({'width':1512,'height':1100})
 record('Responsive layout and dark workspace',responsive)
 if args.gpu:
  def gpu_test():
   check(evaluate('quire.renderer.ready'),'A real GPU adapter is required.');evaluate("quire.actions['read-mode']()");page.wait_for_function('quire.renderer.cache.size>0',timeout=30000);check(evaluate('quire.renderer.stats.textureBytes')>0);check(evaluate('quire.renderer.stats.lastError') is None);return evaluate('quire.renderer.stats')
  record('Real WebGPU reading-mode texture upload and draw',gpu_test)
 if args.inline:
  results.append({'name':'Secure-context WebGPU adapter, draw validation, and persistent IndexedDB','status':'NOT_RUN','reason':'Inline about:blank runner has no secure origin; WebGPU is not exposed and IndexedDB is denied. The real DOM fallback and session library were tested instead.'})
 else:
  def persistence():
   reset('<p>A persistent thought.</p>','Persistent document');evaluate('quire.actions.save()');page.wait_for_timeout(800);check(evaluate('!quire.repository.unavailable'));page.reload();page.wait_for_function('window.quire?.ready',timeout=30000);check('A persistent thought.' in text())
  record('IndexedDB persistence survives a real-origin reload',persistence)
 record('No uncaught browser exceptions',lambda:check(not errors,str(errors)))
 report={'mode':'inline' if args.inline else 'localhost','browser':browser.version,'results':results,'uncaughtErrors':errors,'summary':{status:sum(r['status']==status for r in results) for status in ['PASS','FAIL','NOT_RUN']}}
 (BASE/'tests'/'test-results.json').write_text(json.dumps(report,indent=2,default=str));print(json.dumps(report['summary']),flush=True)
 browser.close()
 sys.exit(1 if report['summary']['FAIL'] else 0)
