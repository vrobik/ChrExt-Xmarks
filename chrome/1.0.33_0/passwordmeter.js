function TestPassword(b){var a=0;4>b.length?a+=3:4<b.length&&8>b.length?a+=6:7<b.length&&16>b.length?a+=12:15<b.length&&(a+=18);b.match(/[a-z]/)&&(a+=1);b.match(/[A-Z]/)&&(a+=5);b.match(/\d+/)&&(a+=5);b.match(/(.*[0-9].*[0-9].*[0-9])/)&&(a+=5);b.match(/.[!,@,#,$,%,^,&,*,?,_,~]/)&&(a+=5);b.match(/(.*[!,@,#,$,%,^,&,*,?,_,~].*[!,@,#,$,%,^,&,*,?,_,~])/)&&(a+=5);b.match(/([a-z].*[A-Z])|([A-Z].*[a-z])/)&&(a+=2);b.match(/([a-zA-Z])/)&&b.match(/([0-9])/)&&(a+=2);b.match(/([a-zA-Z0-9].*[!,@,#,$,%,^,&,*,?,_,~])|([!,@,#,$,%,^,&,*,?,_,~].*[a-zA-Z0-9])/)&&
(a+=2);return a};