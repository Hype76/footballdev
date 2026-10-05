/* eslint-disable */
/* Ported trusted v70 reference; DOM and lifecycle access are scoped by React. */
export default function mountReference(scope) {
const { document, window, fetch, addEventListener, matchMedia, IntersectionObserver, setTimeout, clearTimeout, setInterval, clearInterval } = scope;
const scoreGuide=[
 ['Well Below Standard','The player is currently well below the expected level and needs significant support.'],
 ['Below Standard','The player is below the expected level and needs clear improvement.'],
 ['Needs Improvement','The player shows some understanding but is not yet meeting expectations consistently.'],
 ['Developing','The player is progressing but still has gaps to work on.'],
 ['Expected Level','The player is broadly meeting the expected level for their age/team.'],
 ['Slightly Above Expected','The player is a little above the expected level and showing positive consistency.'],
 ['Good','The player is performing well and often meets a strong standard.'],
 ['Very Good','The player is performing at a very strong level and is consistently effective.'],
 ['Excellent','The player is performing at an excellent level and regularly stands out.'],
 ['Exceptional','The player is performing at an exceptional level for this context.']
];
const scoreInput=document.querySelector('#development-score');
scoreInput?.addEventListener('input',()=>{
 const value=Number(scoreInput.value),[label,copy]=scoreGuide[value-1];
 document.querySelector('[data-development-score]').textContent=`${value} / 10`;
 document.querySelector('[data-development-score-label]').textContent=label;
 document.querySelector('[data-development-score-copy]').textContent=copy;
 scoreInput.setAttribute('aria-valuetext',`${value} out of 10: ${label}`);
});

const ageExamples={
 younger:{focus:'Build familiarity with the ball and confidence to join in: control it, try a pass and find a little space.',fields:['Ball control','Short passing','Dribbling','Finding space','Joining in','Listening and trying'],action:'control the ball, try a pass and move into space'},
 middle:{focus:'Link technique to decisions: look up before receiving, choose a pass and move to support the next action.',fields:['First touch','Passing choices','Receiving under pressure','Support play','Defensive positioning','Response to feedback'],action:'look before receiving, choose a pass and support the next action'},
 older:{focus:'Connect individual actions to the team: read the pressure, understand the role and react when possession changes.',fields:['Scanning','Passing under pressure','Movement off the ball','1v1 defending','Transitions','Communication'],action:'read the pressure, fulfil the role and react to a change of possession'},
 adult:{focus:'Make the assessment specific to the player’s role and the team’s game plan, with practical feedback on execution and decisions.',fields:['Role-specific technique','Decision-making','Ball retention','Off-ball positioning','Defensive organisation','Communication'],action:'carry out a role-specific action and make a useful decision for the team'}
};
const levelExamples={
 starting:{lead:'Keep the focus small and clear.',question:'Can the player {action} in a simple practice, with time and clear support?',next:'Build confidence and understanding before adding more decisions.'},
 developing:{lead:'Look for growing consistency.',question:'Can the player {action} in a small-sided game, with occasional prompts and some pressure?',next:'Use the review to identify where the action becomes less consistent.'},
 experienced:{lead:'Look for independent decisions.',question:'Can the player {action} reliably at the pace and pressure of their own competition, without a reminder?',next:'Make feedback specific to the demands of this team and playing level.'}
};
const ageSelect=document.querySelector('#assessment-age'),levelSelect=document.querySelector('#assessment-level');
const approachSelect=document.querySelector('#assessment-approach');
const feedbackHeading=document.querySelector('[data-feedback-heading]'),feedbackLead=document.querySelector('[data-feedback-lead]');
const originalFeedbackHeading=feedbackHeading?.innerHTML,originalFeedbackLead=feedbackLead?.textContent;
let previousExampleMode='';
function updateAssessmentExample(){
 if(!ageSelect||!levelSelect)return;
 const younger=ageSelect.value==='younger',observations=younger&&approachSelect.value==='observations';
 const exampleMode=`${ageSelect.value}:${younger?approachSelect.value:'standard'}`;
 document.querySelector('[data-younger-approach]').hidden=!younger;
 document.querySelector('[data-younger-guidance]').hidden=!observations;
 document.querySelector('[data-younger-feedback]').hidden=!observations;
 document.querySelector('[data-academy-guidance]').hidden=!(younger&&!observations);
 document.querySelector('[data-coach-observation]').hidden=observations;
 document.querySelector('[data-score-guide]').hidden=observations;
 feedbackHeading.innerHTML=observations?'Encouragement.<br>A small next step.':originalFeedbackHeading;
 feedbackLead.textContent=observations?'Notice enjoyment, effort and the willingness to try. Use a specific positive observation and one achievable idea to explore next, without comparing the player with teammates.':originalFeedbackLead;
 const fieldType=document.querySelector('#assessment-field-type');
 const scoreOption=[...fieldType.options].find(option=>option.value==='Score 1 to 10');
 scoreOption.hidden=observations;scoreOption.disabled=observations;
 if(previousExampleMode!==exampleMode){
  fieldType.value=observations?'Short text':'Score 1 to 10';
 }
 previousExampleMode=exampleMode;
 document.dispatchEvent(new CustomEvent('assessment-context-change'));
 const age=ageExamples[ageSelect.value],level=levelExamples[levelSelect.value];
 document.querySelector('[data-assessment-context]').textContent=`${ageSelect.selectedOptions[0].textContent} · ${younger?approachSelect.selectedOptions[0].textContent:levelSelect.selectedOptions[0].textContent}`;
 document.querySelector('[data-assessment-focus]').textContent=observations?`${age.focus} Keep feedback personal, positive and suited to the player’s experience.`:`${age.focus} ${level.lead}`;
 document.querySelector('[data-assessment-observation]').textContent=level.question.replace('{action}',age.action)+' '+level.next;
 document.querySelector('[data-assessment-fields]').replaceChildren(...(observations?['Enjoyment','Confidence','Trying new skills','Individual progress']:age.fields).map(name=>{const field=document.createElement('span');field.textContent=name;return field}));
}
ageSelect?.addEventListener('change',()=>{approachSelect.value='observations';updateAssessmentExample()});
levelSelect?.addEventListener('change',updateAssessmentExample);
approachSelect?.addEventListener('change',updateAssessmentExample);updateAssessmentExample();

}
