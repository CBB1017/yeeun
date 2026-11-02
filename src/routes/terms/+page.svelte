<script lang="ts">
	import type { PageProps } from './$types';
	import PolicyLayout from '#lib/components/PolicyLayout.svelte';

	let { data }: PageProps = $props();
	const contact = $derived(data.operator.contactEmail);
</script>

<PolicyLayout title="서비스 약관" effective="2026년 11월 2일">
	<section aria-labelledby="t1">
		<h2 id="t1">1. 서비스</h2>
		<p>
			Yeeun(이하 "서비스")은 {data.operator.name}(이하 "운영자")가 제공하는 비공개 업무 자동화 도구입니다.
		</p>
		<ul>
			<li>이용자가 지정한 Google Drive 파일을 자연어 요청에 따라 분석해 결과와 다운로드 파일을 만듭니다.</li>
			<li>같은 원본을 두 AI(Claude, Codex)가 각각 분석하고, 결과와 코드 검산이 일치할 때만 결과를 확정합니다.</li>
		</ul>
	</section>

	<section aria-labelledby="t2">
		<h2 id="t2">2. 이용 자격</h2>
		<ul>
			<li>운영자가 초대한 Google 계정만 이용할 수 있습니다.</li>
			<li>운영자는 언제든 초대를 취소할 수 있으며, 취소하면 로그인과 실행이 즉시 중단됩니다.</li>
			<li>만 14세 미만은 이용할 수 없습니다.</li>
		</ul>
	</section>

	<section aria-labelledby="t3">
		<h2 id="t3">3. 이용자의 책임</h2>
		<ul>
			<li>이용자는 자신이 접근 권한을 가진 파일만 업무에 지정해야 합니다. 개인정보나 영업비밀이 포함된 파일을 다룰 때는 관련 법령과 소속 기관의 규정을 지켜야 합니다.</li>
			<li>서비스 또는 다른 이용자의 데이터에 무단으로 접근하려는 시도, 서비스 사용량을 의도적으로 소진하는 행위, 불법적인 목적의 이용을 금지합니다.</li>
		</ul>
	</section>

	<section aria-labelledby="t4">
		<h2 id="t4">4. 결과의 정확성</h2>
		<p>
			서비스는 두 독립 분석과 코드 검산으로 오류를 줄이지만 모든 오류를 없애지는 못합니다. 결과와 근거를 확인한 뒤 사용해야 하며, 중요한 결정에는 원본을 직접
			확인해야 합니다. 두 분석이 일치하지 않으면 결과를 확정하지 않고 이용자에게 알립니다.
		</p>
	</section>

	<section aria-labelledby="t5">
		<h2 id="t5">5. 원본과 결과물</h2>
		<ul>
			<li>서비스는 원본 Drive 파일을 수정하거나 삭제하지 않으며, 가공한 결과는 새 사본으로 만듭니다.</li>
			<li>결과 사본을 Drive에 올리는 등 외부로 보내는 작업은 이용자가 대상과 파일을 확인하고 승인한 경우에만 수행합니다.</li>
			<li>원본과 결과물의 권리는 이용자 또는 원래 권리자에게 있습니다.</li>
		</ul>
	</section>

	<section aria-labelledby="t6">
		<h2 id="t6">6. 서비스 제공과 중단</h2>
		<ul>
			<li>서비스는 운영자의 컴퓨터와 운영자의 AI 구독 계정으로 실행되며, 모든 이용자가 사용 한도를 함께 씁니다.</li>
			<li>한도 초과, 네트워크 오류, 컴퓨터 꺼짐 등으로 실행이 중단될 수 있습니다. 이때 서비스는 자동으로 다시 시도하지 않고 오류를 알립니다.</li>
			<li>컴퓨터가 꺼져 있는 동안 놓친 예약 실행은 다시 켜졌을 때 업무별로 한 번 실행합니다.</li>
		</ul>
	</section>

	<section aria-labelledby="t7">
		<h2 id="t7">7. 책임의 제한</h2>
		<p>
			서비스는 비공개 도구로서 있는 그대로 제공됩니다. 운영자는 고의 또는 중대한 과실이 없는 한, 서비스 이용이나 결과 사용으로 생긴 손해에 대해 책임지지 않습니다. 다만
			관련 법령상 제한할 수 없는 책임은 예외입니다.
		</p>
	</section>

	<section aria-labelledby="t8">
		<h2 id="t8">8. 개인정보</h2>
		<p>개인정보와 Google 사용자 데이터의 처리는 <a href="/privacy">개인정보처리방침</a>을 따릅니다.</p>
	</section>

	<section aria-labelledby="t9">
		<h2 id="t9">9. 약관 변경과 준거법</h2>
		<p>
			약관이 바뀌면 시행일과 함께 이 페이지에 게시합니다. 이 약관은 대한민국 법률을 따릅니다. 문의:
			{#if contact}<a href="mailto:{contact}">{contact}</a>{:else}운영자 연락처가 아직 설정되지 않았습니다.{/if}
		</p>
	</section>
</PolicyLayout>
