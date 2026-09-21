import { validateInvocationShape, sameInvocationJson } from './invocation-shape.mjs';
export const MESSAGING_CONTRACT='oats.aweb.messaging';
export const MESSAGING_CONTRACT_VERSION=1;
export const RESPONSIBLE_HUMAN_KEY='/bindings/messaging/responsibleHuman';
export const PRIVATE_TEAM_KEY='/bindings/messaging/privateTeam';
export const WIDER_KEY='/bindings/messaging/wider';
const CAPABILITY='oats.aweb';
const identifierPattern=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;
const obj=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value===null || typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const same=(a,b)=>canonical(a)===canonical(b);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function keys(value,allowed,required,label) {
  if(!obj(value)) fail('invalid-binding',`${label} must be an object`);
  for(const key of Object.keys(value)) if(!allowed.includes(key)) fail('invalid-binding',`unknown ${label} property: ${key}`);
  for(const key of required) if(!Object.hasOwn(value,key)) fail('invalid-binding',`${label} requires ${key}`);
  return value;
}
function identifier(value,label='identity') {if(typeof value!=='string' || !identifierPattern.test(value) || ['constructor','__proto__','prototype','toString','valueOf'].includes(value)) fail('invalid-binding',`invalid ${label}`);return value;}
const pointerKey=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1');
export const teamChoiceKey=alias=>`/bindings/messaging/teams/${pointerKey(identifier(alias,'team alias'))}`;
function originAt(declaration,pointer,kind) {
  const found=declaration.origins[pointer] ?? declaration.origin;
  if(!obj(found)) fail('invalid-binding',`missing origin for ${pointer}`);
  return clone({...found,kind});
}
function teamRef(value) {
  keys(value,['provider','id'],['provider','id'],'aweb team reference');
  if(value.provider!==CAPABILITY || typeof value.id!=='string' || !/^[^\s:]+:[^\s:]+$/.test(value.id)) fail('invalid-binding','aweb team reference requires provider oats.aweb and canonical team id');
  return {provider:CAPABILITY,id:value.id};
}
function humanRef(value) {
  keys(value,['provider','id'],['provider','id'],'responsible human');
  if(value.provider!==CAPABILITY || typeof value.id!=='string' || !value.id.trim()) fail('invalid-binding','responsible human needs a provider-resolvable oats.aweb id');
  return {provider:CAPABILITY,id:value.id.trim()};
}
function exactContext(value) {
  if(value?.kind==='workspace') {keys(value,['kind','identity','observation'],['kind','identity','observation'],'workspace context');if(!obj(value.identity) || !obj(value.observation)) fail('invalid-binding','workspace context needs qualified identity and observation');return {kind:'workspace',identity:clone(value.identity)};}
  if(value?.kind==='standalone') {keys(value,['kind','key'],['kind','key'],'standalone context');if(typeof value.key!=='string' || !value.key.trim()) fail('needs-configuration','messaging-enabled standalone preparation needs an explicit context key');return {kind:'standalone',key:value.key.trim()};}
  fail('invalid-binding','unsupported messaging context');
}
function boundContext(value) {
  if(value?.kind==='workspace') {keys(value,['kind','identity'],['kind','identity'],'bound workspace context');if(!obj(value.identity)) fail('invalid-binding','bound workspace context needs qualified identity');return clone(value);}
  if(value?.kind==='standalone') {keys(value,['kind','key'],['kind','key'],'bound standalone context');if(typeof value.key!=='string' || !value.key.trim()) fail('invalid-binding','bound standalone context needs an explicit key');return {kind:'standalone',key:value.key.trim()};}
  fail('invalid-binding','unsupported bound messaging context');
}
function declaration(value) {
  keys(value,['kind','value','origin','origins'],['kind','value','origin','origins'],'messaging declaration');
  if(!['soul','workspace','adoption','operator'].includes(value.kind) || !obj(value.value) || !obj(value.origin) || !obj(value.origins)) fail('invalid-binding','invalid messaging declaration');
  return value;
}

/** Emit messaging provider fields for the kernel's single resolver. Team aliases
 * are availability data; only the explicit operator wider list is consent. */
export function normalizeMessagingDeclarations({declarations,context}={}) {
  if(!Array.isArray(declarations)) fail('invalid-binding','messaging declarations must be an array');
  const exact=exactContext(context),contextOrigin=context?.kind==='workspace'?clone(context.observation):null,requirements=[],candidates=[],teams={},requested=[],requestedOrigins={},aliases={},aliasOrigins={};let soul=null,privatePolicy=false,privatePolicyOrigin=null;
  for(const raw of declarations) {
    const item=declaration(raw);
    // The kernel supplies complete validated source/workspace/operator
    // declarations, including other providers' fields. Consume only messaging
    // fields here; do not impose a second closed schema on the whole document.
    if(item.kind==='soul') {
      if(soul) fail('requirement-conflict','multiple soul messaging declarations');soul=item;
      const list=item.value.teams ?? [];
      if(!Array.isArray(list) || new Set(list).size!==list.length) fail('invalid-binding','soul teams must be a unique array');
      for(let index=0;index<list.length;index++) {const alias=identifier(list[index],'soul team alias');requested.push(alias);requestedOrigins[alias]=originAt(item,`/teams/${index}`,'soul-requirement');}
    } else if(item.kind==='workspace') {
      const value=item.value.teams;if(value===undefined) continue;if(!obj(value)) fail('invalid-binding','workspace teams must be an object');
      for(const [alias,ref] of Object.entries(value)) {
        if(alias==='private') {if(ref!=='per-human') fail('invalid-binding','workspace private team policy must be per-human');privatePolicy=true;privatePolicyOrigin=originAt(item,'/teams/private','workspace-default');continue;}
        const key=teamChoiceKey(alias),origin=originAt(item,`/teams/${pointerKey(alias)}`,'workspace-default');
        teams[alias]=key;candidates.push({key,kind:'workspace-default',value:teamRef(ref),origin});
      }
    } else if(item.kind==='adoption') {
      const value=item.value.teamAliases;if(value===undefined) continue;if(!obj(value)) fail('invalid-binding','adoption teamAliases must be an object');
      for(const [source,target] of Object.entries(value)) {
        identifier(source,'source team alias');identifier(target,'workspace team alias');
        if(Object.hasOwn(aliases,source) && aliases[source]!==target) fail('requirement-conflict','adoption team aliases have conflicting mappings');
        aliases[source]=target;aliasOrigins[source]=originAt(item,`/teamAliases/${pointerKey(source)}`,'import-adoption');
      }
    } else {
      const bindings=item.value.bindings;if(bindings===undefined) continue;
      if(!obj(bindings)) fail('invalid-binding','operator bindings must be an object');
      if(Object.hasOwn(bindings,'responsibleHuman')) candidates.push({key:RESPONSIBLE_HUMAN_KEY,kind:'operator',value:humanRef(bindings.responsibleHuman),origin:originAt(item,'/bindings/responsibleHuman','operator')});
      if(Object.hasOwn(bindings,'privateTeam')) candidates.push({key:PRIVATE_TEAM_KEY,kind:'operator',value:teamRef(bindings.privateTeam),origin:originAt(item,'/bindings/privateTeam','operator')});
      if(Object.hasOwn(bindings,'wider')) {
        if(!Array.isArray(bindings.wider) || new Set(bindings.wider).size!==bindings.wider.length) fail('invalid-binding','operator wider consent must be a unique array');
        candidates.push({key:WIDER_KEY,kind:'operator',value:bindings.wider.map(alias=>identifier(alias,'wider team alias')),origin:originAt(item,'/bindings/wider','operator')});
      }
    }
  }
  if(!soul) fail('needs-configuration','messaging binding needs one soul declaration');
  if(exact.kind==='workspace' && !privatePolicy) fail('needs-configuration','messaging workspace must declare private: per-human');
  const rootOrigin=originAt(soul,'','soul-requirement');
  requirements.push({key:RESPONSIBLE_HUMAN_KEY,kind:'required',origin:rootOrigin},{key:WIDER_KEY,kind:'required',origin:rootOrigin});
  return {requirements,candidates,model:{contract:MESSAGING_CONTRACT,version:MESSAGING_CONTRACT_VERSION,context:exact,contextOrigin,requested,requestedOrigins,aliases,aliasOrigins,teams,privatePolicy,privatePolicyOrigin}};
}
function selected(choices,key,{optional=false}={}) {
  const choice=choices?.[key];if(!obj(choice) || !Object.hasOwn(choice,'value') || choice.value===null) {if(optional)return null;fail('needs-configuration',key===RESPONSIBLE_HUMAN_KEY?'an explicit responsible-human binding is required':key===WIDER_KEY?'an explicit wider-membership consent list is required':'a selected wider-team binding is required');}return choice;
}

export function bindMessagingDomain({model,choices}={}) {
  if(!obj(model) || model.contract!==MESSAGING_CONTRACT || model.version!==MESSAGING_CONTRACT_VERSION) fail('invalid-binding','invalid normalized messaging model');
  const humanChoice=selected(choices,RESPONSIBLE_HUMAN_KEY),widerChoice=selected(choices,WIDER_KEY),human=humanRef(humanChoice.value);
  if(!Array.isArray(widerChoice.value) || new Set(widerChoice.value).size!==widerChoice.value.length) fail('invalid-binding','resolved wider consent must be a unique array');
  const wider=[],provenance=[humanChoice.selectedBy,widerChoice.selectedBy,model.contextOrigin,model.privatePolicyOrigin].filter(obj).map(clone);
  for(const sourceAlias of widerChoice.value) {
    identifier(sourceAlias,'wider team alias');if(!model.requested.includes(sourceAlias)) fail('invalid-binding',`wider consent names undeclared soul alias: ${sourceAlias}`);
    const workspaceAlias=model.aliases[sourceAlias] ?? sourceAlias,key=model.teams[workspaceAlias];if(!key) fail('needs-configuration','a selected wider alias needs an explicit workspace team mapping');
    const choice=selected(choices,key),ref=teamRef(choice.value);wider.push(ref);if(obj(choice.selectedBy)) provenance.push(clone(choice.selectedBy));
    if(obj(model.requestedOrigins[sourceAlias])) provenance.push(clone(model.requestedOrigins[sourceAlias]));
    if(obj(model.aliasOrigins[sourceAlias])) provenance.push(clone(model.aliasOrigins[sourceAlias]));
  }
  wider.sort((a,b)=>Buffer.compare(Buffer.from(canonical(a)),Buffer.from(canonical(b))));
  for(let index=1;index<wider.length;index++) if(same(wider[index-1],wider[index])) fail('invalid-binding','duplicate resolved wider team');
  const privateChoice=selected(choices,PRIVATE_TEAM_KEY,{optional:true}),privateTeam=privateChoice?teamRef(privateChoice.value):null;if(privateTeam && wider.some(item=>same(item,privateTeam))) fail('invalid-binding','private team cannot also be a wider team');if(obj(privateChoice?.selectedBy)) provenance.push(clone(privateChoice.selectedBy));
  const unique=[];for(const item of provenance) if(!unique.some(prior=>same(prior,item))) unique.push(item);
  const privateKey={provider:CAPABILITY,human,context:clone(model.context)};
  return {payloadContract:MESSAGING_CONTRACT,payloadVersion:MESSAGING_CONTRACT_VERSION,payload:{responsibleHuman:human,context:clone(model.context),privateTeam,wider},credentialRefs:{},provenance:unique,
    messagingChoice:{schemaVersion:1,enabled:true,privateKey,wider:clone(wider),provenance:clone(unique)}};
}

export function validateAwebBinding(binding) {
  keys(binding,['schemaVersion','capability','payloadContract','payloadVersion','payload','credentialRefs','provenance'],['schemaVersion','capability','payloadContract','payloadVersion','payload','credentialRefs','provenance'],'aweb provider binding');
  if(binding.schemaVersion!==1 || binding.capability!==CAPABILITY || binding.payloadContract!==MESSAGING_CONTRACT || binding.payloadVersion!==MESSAGING_CONTRACT_VERSION || !obj(binding.payload) || !obj(binding.credentialRefs) || !Array.isArray(binding.provenance)) fail('invalid-binding','invalid aweb provider binding');
  keys(binding.payload,['responsibleHuman','context','privateTeam','wider'],['responsibleHuman','context','privateTeam','wider'],'aweb binding payload');
  humanRef(binding.payload.responsibleHuman);boundContext(binding.payload.context);if(!Array.isArray(binding.payload.wider)) fail('invalid-binding','aweb wider teams must be an array');
  const wider=binding.payload.wider.map(teamRef);for(let index=1;index<wider.length;index++) {if(same(wider[index-1],wider[index])) fail('invalid-binding','duplicate aweb wider team');if(Buffer.compare(Buffer.from(canonical(wider[index-1])),Buffer.from(canonical(wider[index])))>0) fail('invalid-binding','aweb wider teams are not canonical');}
  if(binding.payload.privateTeam!==null) {
    const privateTeam=teamRef(binding.payload.privateTeam);
    if(wider.some(team=>same(team,privateTeam))) fail('invalid-binding','private team cannot also be a wider team');
  }
  if(Object.keys(binding.credentialRefs).length) fail('invalid-binding','no credential reference shape is supported by this binding version');
  return binding;
}

export function validateAwebInvocationContext(value,binding,expected={}) {
  validateAwebBinding(binding);
  validateInvocationShape(value,{...expected,capability:CAPABILITY});
  const selected=value.context.kind==='workspace'?{kind:'workspace',identity:value.context.identity}:value.context;
  if(value.messagingChoice.enabled!==true || value.messagingChoice.privateKey.provider!==CAPABILITY || !sameInvocationJson(selected,binding.payload.context)
    || !sameInvocationJson(value.responsibleHuman,binding.payload.responsibleHuman) || !sameInvocationJson(value.messagingChoice.wider,binding.payload.wider)) fail('invalid-binding','invocation contradicts messaging binding');
  return value;
}
