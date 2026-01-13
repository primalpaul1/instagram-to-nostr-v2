<script lang="ts">
  import WizardLayout from '$lib/components/WizardLayout.svelte';
  import HandleStep from '$lib/components/steps/HandleStep.svelte';
  import KeysStep from '$lib/components/steps/KeysStep.svelte';
  import VideosStep from '$lib/components/steps/VideosStep.svelte';
  import ConfirmStep from '$lib/components/steps/ConfirmStep.svelte';
  import ProgressStep from '$lib/components/steps/ProgressStep.svelte';
  import ProgressStepNIP46 from '$lib/components/steps/ProgressStepNIP46.svelte';
  import CompleteStep from '$lib/components/steps/CompleteStep.svelte';
  import { wizard } from '$lib/stores/wizard';

  // Debug: log step changes
  $: console.log('+page.svelte: Current step is:', $wizard.step);
</script>

<WizardLayout>
  {#if $wizard.step === 'handle'}
    <HandleStep />
  {:else if $wizard.step === 'keys'}
    <KeysStep />
  {:else if $wizard.step === 'videos'}
    <VideosStep />
  {:else if $wizard.step === 'confirm'}
    <ConfirmStep />
  {:else if $wizard.step === 'progress'}
    <ProgressStep />
  {:else if $wizard.step === 'progress-nip46'}
    <ProgressStepNIP46 />
  {:else if $wizard.step === 'complete'}
    <CompleteStep />
  {/if}
</WizardLayout>
