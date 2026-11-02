<script lang="ts">
	import type { PageProps } from './$types';
	import PolicyLayout from '#lib/components/PolicyLayout.svelte';

	let { data }: PageProps = $props();
	const contact = $derived(data.operator.contactEmail);
</script>

<PolicyLayout title="개인정보처리방침" effective="2026년 11월 2일">
	<section>
		<p>
			{data.operator.name}(이하 "운영자")는 Yeeun(이하 "서비스")을 운영하면서 이용자의 개인정보와 Google 사용자 데이터를 아래와 같이
			처리합니다. 서비스는 운영자가 초대한 사람만 사용할 수 있는 비공개 업무 자동화 도구입니다.
		</p>
	</section>

	<section aria-labelledby="p1">
		<h2 id="p1">1. 처리하는 정보</h2>
		<ul>
			<li><strong>Google 계정 정보</strong>: 이메일 주소, 이름, Google 계정 고유 식별자. 로그인과 초대 확인에만 사용합니다.</li>
			<li>
				<strong>Google Drive 데이터</strong>:
				<ul>
					<li>자연어 검색 시 내 Drive 파일의 이름, 형식, 수정 시각, 상위 폴더 이름(후보 표시용, 파일 내용은 읽지 않음)</li>
					<li>이용자가 확인해 업무에 지정한 파일의 내용과 버전 정보</li>
					<li>이용자가 승인한 경우 서비스가 새로 만든 결과 사본의 업로드 정보</li>
				</ul>
			</li>
			<li><strong>업무 정보</strong>: 이용자가 입력한 요청 문장, 업무 계획과 예약, 실행 결과, 결과의 근거 발췌, 생성한 다운로드 파일.</li>
			<li><strong>알림 정보</strong>(선택): 알림 수신 이메일 주소, 브라우저 푸시 구독 정보, 이용자가 등록한 발신 메일 계정 정보(암호화 저장).</li>
			<li><strong>운영 기록</strong>: 요청 식별자, 처리 시각, 오류 코드 등. 파일 내용, 비밀번호, 인증 토큰은 기록하지 않습니다.</li>
		</ul>
	</section>

	<section aria-labelledby="p2">
		<h2 id="p2">2. 이용 목적</h2>
		<p>
			이용자가 직접 요청한 업무(파일 분석, 결과 정리, 다운로드 파일 생성, 예약 실행, 알림)를 수행하는 데에만 사용합니다. 광고, 판매, 이용자 프로필 작성, 신용 평가 등에는
			사용하지 않습니다.
		</p>
	</section>

	<section aria-labelledby="p3">
		<h2 id="p3">3. Google 사용자 데이터</h2>
		<ul>
			<li>
				서비스가 Google API로부터 받은 정보의 사용과 다른 앱으로의 전송은 제한적 사용(Limited Use) 요구사항을 포함한
				<a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API 서비스 사용자 데이터 정책</a>을 준수합니다.
			</li>
			<li>
				Drive 권한은 두 가지입니다.
				<ul>
					<li>읽기 전용 권한: 이용자 요청에 맞는 파일을 찾고, 이용자가 확인한 파일을 읽습니다.</li>
					<li>앱이 만든 파일에 대한 권한: 이용자가 승인한 결과 사본을 새 파일로 올립니다.</li>
				</ul>
			</li>
			<li>원본 Drive 파일은 수정하거나 삭제하지 않습니다.</li>
			<li>Google 사용자 데이터를 일반 인공지능·머신러닝 모델의 개발, 개선, 학습에 사용하지 않으며, 사람이 열람하지 않습니다. 다만 이용자의 동의가 있거나, 보안·법적 의무 이행에 필요한 경우는 예외입니다.</li>
			<li>
				이용자는 서비스의 "허용한 파일" 화면에서 Drive 연결을 해제할 수 있고,
				<a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google 계정 권한 페이지</a>에서도 접근 권한을 취소할 수 있습니다.
			</li>
		</ul>
	</section>

	<section aria-labelledby="p4">
		<h2 id="p4">4. 처리 위탁 및 제3자 전송</h2>
		<ul>
			<li>
				분석을 위해 이용자가 지정한 파일에서 추출한 내용과 요청 문장을 아래 두 AI 서비스로 각각 전송합니다. 두 서비스 모두 운영자의 구독 계정으로 사용합니다.
				<ul>
					<li>Anthropic PBC의 Claude Code</li>
					<li>OpenAI의 Codex</li>
				</ul>
				운영자는 두 계정 모두 대화 내용을 모델 학습에 사용하는 설정을 해제한 상태로 운영합니다.
			</li>
			<li>알림 이메일은 운영자 또는 이용자가 지정한 메일 서버(예: Gmail SMTP)를 통해, 브라우저 푸시는 브라우저 제조사의 푸시 서비스를 통해 전송합니다.</li>
			<li>그 밖의 제3자에게 개인정보를 제공하거나 판매하지 않습니다. 법령에 따른 요청이 있는 경우는 예외입니다.</li>
		</ul>
	</section>

	<section aria-labelledby="p5">
		<h2 id="p5">5. 보관 기간과 파기</h2>
		<ul>
			<li>업무 실행 때 확보한 원본 사본(스냅샷)은 결과가 정상적으로 확정되면 삭제합니다.</li>
			<li>오류가 나거나 검토를 기다리는 동안에는 확인을 위해 원본 사본과 부분 결과를 보관합니다.</li>
			<li>정상 결과, 다운로드 파일, 분석한 파일의 버전 정보와 근거 발췌는 이용자가 다시 확인할 수 있도록 보관하며, 이용자가 삭제를 요청하면 파기합니다.</li>
			<li>Drive 연결을 해제하면 저장된 Drive 인증 토큰을 폐기합니다. 초대가 취소되면 해당 계정의 로그인과 실행이 즉시 차단되며, 요청 시 관련 데이터를 파기합니다.</li>
		</ul>
	</section>

	<section aria-labelledby="p6">
		<h2 id="p6">6. 저장 위치와 보호 조치</h2>
		<ul>
			<li>데이터는 운영자가 관리하는 컴퓨터(대한민국)의 데이터베이스와 저장 폴더에 보관합니다.</li>
			<li>인증 토큰과 메일 비밀번호는 암호화(AES-256-GCM)해 저장합니다.</li>
			<li>이용자마다 데이터에 접근할 수 있는 범위를 분리하고, 원본 파일은 쓰기 권한 없이 다룹니다.</li>
			<li>AI 서비스는 다른 이용자의 파일이나 데이터베이스에 접근할 수 없는 별도 환경에서 실행합니다.</li>
		</ul>
	</section>

	<section aria-labelledby="p7">
		<h2 id="p7">7. 이용자의 권리</h2>
		<p>
			이용자는 자신의 개인정보 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다. 아래 연락처로 요청하면 지체 없이 처리합니다. 만 14세 미만은 서비스를 이용할 수
			없습니다.
		</p>
	</section>

	<section aria-labelledby="p8">
		<h2 id="p8">8. 변경과 연락처</h2>
		<p>
			이 방침이 바뀌면 시행일과 함께 이 페이지에 게시합니다. 개인정보 관련 문의:
			{#if contact}<a href="mailto:{contact}">{contact}</a>{:else}운영자 연락처가 아직 설정되지 않았습니다.{/if}
		</p>
	</section>
</PolicyLayout>
