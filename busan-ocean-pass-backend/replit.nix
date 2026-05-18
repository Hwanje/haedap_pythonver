# =============================================
# replit.nix - 부산오션패스 Nix 환경 정의
#
# .replit 의 [nix] channel = "stable-24_05" 가 우선 적용됩니다.
# 이 파일은 추가 시스템 패키지가 필요할 경우를 위한 백업 정의입니다.
# better-sqlite3 네이티브 빌드에 필요한 빌드 도구를 포함합니다.
# =============================================
{ pkgs }:
{
  deps = [
    # Node.js 런타임 (20 LTS)
    pkgs.nodejs_20

    # better-sqlite3 네이티브 모듈 빌드에 필요한 도구
    # (빌드 실패 시 자동으로 sql.js로 폴백됩니다)
    pkgs.nodePackages.node-gyp
    pkgs.python3
    pkgs.gcc

    # 개발 편의 도구
    pkgs.curl
    pkgs.jq
  ];
}
