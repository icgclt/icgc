-- Repairs phone numbers that Excel damaged during a CSV import. Back up first. Run the PREVIEW first.
--
-- What Excel does:  0244123456 -> 244123456 (leading 0 lost)     fixed here by putting the 0 back
--                   233244123456 / +233244123456                 fixed here to 0244123456
--                   2.43E+08                                       the digits are gone for good; listed so they can be typed in again

-- 1) PREVIEW (changes nothing)
select name, member_code, phone,
       case
         when phone ~ '^[1-9][0-9]{8}$'          then '0' || phone
         when phone ~ '^\+?233[0-9]{9}$'         then '0' || right(regexp_replace(phone, '[^0-9]', '', 'g'), 9)
         else null
       end as will_become,
       case when phone ~* '^[0-9]+(\.[0-9]+)?e[+-]?[0-9]+$' then 'DAMAGED - re-enter by hand' end as note
from public.members
where phone ~ '^[1-9][0-9]{8}$' or phone ~ '^\+?233[0-9]{9}$' or phone ~* '^[0-9]+(\.[0-9]+)?e[+-]?[0-9]+$'
order by note nulls last, name;

-- 2) APPLY: only after reading the preview.
begin;

update public.members set phone = '0' || phone                                          where phone ~ '^[1-9][0-9]{8}$';
update public.members set phone = '0' || right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) where phone ~ '^\+?233[0-9]{9}$';
update public.members set parent1_phone = '0' || parent1_phone                          where parent1_phone ~ '^[1-9][0-9]{8}$';
update public.members set parent2_phone = '0' || parent2_phone                          where parent2_phone ~ '^[1-9][0-9]{8}$';

commit;

-- 3) The damaged ones (shown like 2.43E+08) cannot be recovered. This blanks them so SMS ignores them; type the real numbers in again.
-- update public.members set phone = '' where phone ~* '^[0-9]+(\.[0-9]+)?e[+-]?[0-9]+$';
