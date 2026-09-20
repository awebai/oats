/** Provider composition over one frozen source/workspace observation. Provider
 * codecs normalize fields; only resolveChoices selects their values. */
import { canonicalJson } from './portable-values.mjs';
import { resolveChoices } from './portable-choices.mjs';
import { validateOrigin } from './resolution-shape.mjs';
import { pointerKey } from './portable-shape.mjs';
import { bindingField, bindingOriginWitnessed } from './provider-binding-wire.mjs';
import { oatsError } from './errors.mjs';

/** Remap dictionary keys for an adoption subtree, but retain original document
 * pointers/spans inside each witness. No file/config is read here. */
export function bindingDeclaration(kind,value,origins,pointer='') {
  const role={soul:'soul-requirement',workspace:'workspace-default',adoption:'import-adoption',operator:'operator'}[kind];
  if (!role || !origins?.[pointer]) throw oatsError('invalid-declaration','binding input has no original declaration witness');
  const mapped=Object.create(null);
  for (const [key,origin] of Object.entries(origins)) {
    if (key !== pointer && !key.startsWith(`${pointer}/`)) continue;
    const witnessed={...origin,kind:role};validateOrigin(witnessed);
    mapped[key.slice(pointer.length)]=witnessed;
  }
  return {kind,value,origin:mapped[''],origins:mapped};
}
export function operatorBindingDeclaration(operator) {
  canonicalJson(operator);
  const origins=Object.create(null);
  const mark=(value,pointer)=>{
    origins[pointer]={kind:'operator',document:operator.document,pointer};
    if (value && typeof value === 'object') for (const [key,child] of Object.entries(value)) mark(child,`${pointer}/${pointerKey(key)}`);
  };
  mark(operator,'');
  return bindingDeclaration('operator',operator,origins);
}
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const safeCodes=new Set(['approval-required','needs-configuration','requirement-conflict','invalid-binding','invalid-binding-output',
  'authorization-required','host-requirement-missing','provider-unavailable','provider-not-qualified','resource-not-found','integrity-drift']);
export function prepareProviderBindings({seed,plan,manifests,declarations},invoke) {
  const normalized=new Map(),problems=[],requirements=[...plan.requirements],candidates=[...plan.candidates];
  const settingsFor=id=>Object.fromEntries(Object.entries(plan.settings[id] ?? {}).map(([name,key])=>[name,plan.choices[key].value]));
  const run=(id,phase,input)=>invoke({artifacts:seed.artifacts,capability:id,phase,settings:settingsFor(id),input});
  const originsFor=id=>[...new Map((plan.capabilities[id]?.choiceKeys ?? []).flatMap(key=>{
    const choice=plan.choices[key];return choice?.selectedBy?[choice.selectedBy]:[];
  }).map(origin=>[canonicalJson(origin),origin])).values()];
  const problem=(slot,id,code,message,origins=originsFor(id))=>({code,message,origins,slot,capability:id});
  const refuse=(slot,id,phase,error)=>problem(slot,id,safeCodes.has(error?.code)?error.code:'provider-not-qualified',
    `${id} ${slot} ${phase} binding could not be prepared`); // Never provider free text.
  for (const [id,manifest] of manifests) {
    if (!Object.hasOwn(seed.artifacts.capabilities,id) || !manifest.layer) continue;
    if (plan.providers[manifest.layer] !== id) problems.push(problem(manifest.layer,id,'needs-configuration','fundamental capability must be selected in its own layer'));
  }
  for (const [slot,id] of Object.entries(plan.providers)) {
    if (id === null) continue;
    const manifest=manifests.get(id);
    if (manifest?.layer !== slot) { problems.push(problem(slot,id,'provider-not-qualified',`${id} does not declare the selected ${slot} layer`));continue; }
    if (!manifest.binding) { problems.push(problem(slot,id,'provider-not-qualified',`${id}@${manifest.version} declares no binding interface; ${slot} cannot be prepared`));continue; }
    try {
      const value=run(id,'normalize',{declarations,context:seed.context});
      normalized.set(slot,{id,value}); requirements.push(...value.requirements);candidates.push(...value.candidates);
    } catch(error) { problems.push(refuse(slot,id,'normalize',error)); }
  }
  // One unsupported slot must not mask another slot's normalized requirements
  // or invalid choices. The same resolver still decides every value.
  const resolved=resolveChoices({requirements,candidates});
  for (const item of resolved.problems) {
    const slot=Object.keys(plan.providers).find(slot=>bindingField(item.key,slot));
    if (!slot) throw oatsError('invalid-binding-output','provider choice problem has no owned binding slot');
    problems.push({...item,slot,capability:plan.providers[slot]});
  }
  const nextPlan={...plan,...resolved,requirements,candidates},bindings=Object.create(null);
  let messagingChoice={schemaVersion:1,enabled:false};
  const known=[];
  for (const choice of Object.values(resolved.choices)) {
    if (choice.selectedBy) known.push(choice.selectedBy);
    for (const item of [...choice.constraints,...choice.considered]) known.push(item.origin);
  }
  const witnessed=origin=>bindingOriginWitnessed(origin,declarations) || known.some(candidate=>same(candidate,origin));
  for (const [slot,{id,value}] of normalized) {
    if (resolved.problems.some(item=>bindingField(item.key,slot))) continue;
    try {
      const choices=Object.fromEntries(Object.entries(resolved.choices).filter(([key])=>bindingField(key,slot)));
      const bound=run(id,'bind',{model:value.model,choices,context:seed.context});
      for (const origin of [...bound.binding.provenance,...(bound.messagingChoice?.provenance ?? [])]) {
        if (!witnessed(origin)) throw oatsError('invalid-binding-output','binding provenance is not witnessed by this preparation');
      }
      bindings[slot]=bound.binding;
      if (slot === 'messaging') messagingChoice=bound.messagingChoice;
    } catch(error) { problems.push(refuse(slot,id,'bind',error)); }
  }
  nextPlan.problems=problems;
  nextPlan.status=problems.some(item=>item.code==='requirement-conflict')?'conflict':problems.length?'needs-configuration':'resolved';
  return {plan:nextPlan,seed:{...seed,choices:resolved.choices,bindings,messagingChoice},problems};
}
